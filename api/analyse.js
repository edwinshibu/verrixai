const ALLOWED_ORIGIN  = 'https://verrixai.com';
const MAX_TEXT_LENGTH = 60000;
const ALLOWED_MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 4000;

// Simple in-memory rate limiter (per IP, resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT   = 10;
const RATE_WINDOW  = 60 * 1000;

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

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const body = req.body;
  if (!body || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: 'Invalid request format.' });
  }

  const userMessage = body.messages.find(m => m.role === 'user');
  if (!userMessage) return res.status(400).json({ error: 'No user message provided.' });

  let userContent = userMessage.content;

  if (typeof userContent === 'string') {
    if (userContent.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: 'Document too large. Please reduce the size and try again.' });
    }
  } else if (Array.isArray(userContent)) {
    const textPart = userContent.find(p => p.type === 'text');
    if (textPart?.text?.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: 'Document too large. Please reduce the size and try again.' });
    }
    const docPart = userContent.find(p => p.type === 'document');
    if (docPart) {
      if (!docPart.source?.data || typeof docPart.source.data !== 'string') {
        return res.status(400).json({ error: 'Invalid document format.' });
      }
      if (docPart.source.data.length > 13_000_000) {
        return res.status(400).json({ error: 'Document too large.' });
      }
      if (docPart.source.media_type !== 'application/pdf') {
        return res.status(400).json({ error: 'Only PDF documents are supported.' });
      }
    }
  } else {
    return res.status(400).json({ error: 'Invalid content format.' });
  }

  try {
    // ── Streaming headers ──────────────────────────────────────
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');

    // ── Call Anthropic with stream: true ───────────────────────
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      ALLOWED_MODEL,
        max_tokens: MAX_TOKENS,
        stream:     true,
        messages:   [{ role: 'user', content: userContent }]
      })
    });

    if (!anthropicRes.ok) {
      const errData = await anthropicRes.json().catch(() => ({}));
      return res.status(anthropicRes.status).json({ error: errData.error?.message || 'Anthropic API error' });
    }

    // ── Read SSE stream, extract text deltas, forward to client ─
    const reader  = anthropicRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            res.write(parsed.delta.text);
          }
        } catch(e) {
          // Ignore malformed SSE lines
        }
      }
    }

    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    // If headers already sent (streaming started), just end
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to reach Anthropic API' });
    }
  }
};
