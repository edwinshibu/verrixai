module.exports = async function handler(req, res) {
  // CORS: restrict to your domain only
  const allowedOrigins = ['https://verrixai.com', 'https://www.verrixai.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // Input validation
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  // Only allow user role messages
  for (const msg of messages) {
    if (msg.role !== 'user') {
      return res.status(400).json({ error: 'Invalid message format.' });
    }
  }

  // Body size limit: reject documents over 150KB
  const bodySize = JSON.stringify(req.body).length;
  if (bodySize > 150000) {
    return res.status(413).json({ error: 'Document is too large. Please use a smaller document.' });
  }

  // Rate limiting: max 10 requests per IP per minute
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (!global._rateLimitStore) global._rateLimitStore = {};
  if (!global._rateLimitStore[ip]) global._rateLimitStore[ip] = [];
  global._rateLimitStore[ip] = global._rateLimitStore[ip].filter(t => now - t < 60000);
  if (global._rateLimitStore[ip].length >= 10) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }
  global._rateLimitStore[ip].push(now);

  // Extract only the last user message content — never pass raw req.body to Anthropic
  const userMessage = messages[messages.length - 1];
  let userContent = userMessage.content;

  if (Array.isArray(userContent)) {
    // File upload: allow text + document blocks only, max 2 blocks
    userContent = userContent
      .filter(block => block.type === 'text' || block.type === 'document')
      .slice(0, 2);
  } else if (typeof userContent === 'string') {
    userContent = userContent.slice(0, 100000);
  } else {
    return res.status(400).json({ error: 'Invalid content format.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', // locked server-side
        max_tokens: 1500,                  // locked server-side
        messages: [{ role: 'user', content: userContent }]
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Failed to reach Anthropic API' });
  }
};
