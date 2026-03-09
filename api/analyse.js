const ALLOWED_ORIGIN = 'https://verrixai.com';
const MAX_TEXT_LENGTH = 60000;
const ALLOWED_MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 4000;

// Simple in-memory rate limiter (per IP, resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT  = 10;         // max requests
const RATE_WINDOW = 60 * 1000;  // per 60 seconds

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // Validate request body structure
  const body = req.body;
  if (!body || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: 'Invalid request format.' });
  }

  const userMessage = body.messages.find(m => m.role === 'user');
  if (!userMessage) return res.status(400).json({ error: 'No user message provided.' });

  // Validate and sanitise content
  let userContent = userMessage.content;

  if (typeof userContent === 'string') {
    if (userContent.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: 'Document too large. Please reduce the size and try again.' });
    }
  } else if (Array.isArray(userContent)) {
    // PDF + text array
    const textPart = userContent.find(p => p.type === 'text');
    if (textPart?.text?.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: 'Document too large. Please reduce the size and try again.' });
    }
    const docPart = userContent.find(p => p.type === 'document');
    if (docPart) {
      if (!docPart.source?.data || typeof docPart.source.data !== 'string') {
        return res.status(400).json({ error: 'Invalid document format.' });
      }
      // Reject base64 payloads over ~10MB
      if (docPart.source.data.length > 13_000_000) {
        return res.status(400).json({ error: 'Document too large.' });
      }
      // Only allow PDF media type
      if (docPart.source.media_type !== 'application/pdf') {
        return res.status(400).json({ error: 'Only PDF documents are supported.' });
      }
    }
  } else {
    return res.status(400).json({ error: 'Invalid content format.' });
  }

  try {
    // Send keep-alive header immediately — prevents Vercel from killing the
    // connection during cold starts before Claude responds
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');

    // Build request ourselves — never forward client body directly
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 22000); // 22s — under Vercel's 30s limit

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      ALLOWED_MODEL,
        max_tokens: MAX_TOKENS,
        messages:   [{ role: 'user', content: userContent }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out. Please try again.' });
    }
    return res.status(500).json({ error: 'Failed to reach Anthropic API' });
  }
};
