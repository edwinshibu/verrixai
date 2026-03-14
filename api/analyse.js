// Serverless function (Node.js runtime) — maxDuration: 60 in vercel.json
// Uses Node.js req/res style for full compatibility with Vercel Serverless.

const ALLOWED_ORIGIN  = 'https://verrixai.com';
const MAX_TEXT_LENGTH = 60000;
const ALLOWED_MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 4000;

const SYSTEM_PROMPT = `You are a document analyst. You MUST respond ONLY with a single valid JSON object — no markdown, no preamble, no text outside the JSON.

Analyse the document and return this JSON:
{"IS_LEGAL":true/false,"SUMMARY":"...","RISKS":[{"level":"HIGH","title":"...","desc":"..."}],"KEY_POINTS":["..."],"SIMPLIFIED":"..."}

IS_LEGAL: true if this is a legal/contractual/business document. false for anything else (CV, academic, personal docs etc).

RISKS must be a JSON array of objects with keys: level (HIGH/MEDIUM/LOW), title (string), desc (string). Include 3–6 items.
KEY_POINTS must be a JSON array of strings. Include 4–7 items.
SUMMARY must be a plain string, 3–5 sentences.
SIMPLIFIED must be a plain string, plain-English rewrite, 3–5 sentences, no jargon.

CRITICAL: Always populate every requested field with real analysis. Never leave fields empty or null. If not a legal document, still analyse what the document contains and note what type it is.`;

const KEY_MAP = { summary: 'SUMMARY', risks: 'RISKS', keypoints: 'KEY_POINTS', simplify: 'SIMPLIFIED' };

export default async function handler(req, res) {

  // ── CORS headers on every response ────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ── CORS preflight ─────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ── Keepalive — GET returns instantly, keeps function warm ──
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // ── Parse body ─────────────────────────────────────────────
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Empty request body' });

  let rawContent;
  let options = [];

  if (body?.content !== undefined) {
    rawContent = body.content;
    options    = Array.isArray(body.options) ? body.options : [];
  } else {
    return res.status(400).json({ error: 'Invalid request format.' });
  }

  // ── Validate content ───────────────────────────────────────
  if (typeof rawContent === 'string') {
    if (rawContent.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: 'Document too large. Please reduce the size and try again.' });
    }
  } else {
    return res.status(400).json({ error: 'Invalid content format.' });
  }

  // ── Build user message ─────────────────────────────────────
  const requestedKeys = options.length
    ? ['IS_LEGAL', ...options.map(o => KEY_MAP[o]).filter(Boolean)]
    : ['IS_LEGAL', 'SUMMARY', 'RISKS', 'KEY_POINTS', 'SIMPLIFIED'];
  const dynamicInstruction = `Only include these keys in your JSON response: ${requestedKeys.join(', ')}.`;

  const userContent = `${dynamicInstruction}\n\nDOCUMENT:\n"""\n${rawContent}\n"""`;

  // ── Call Anthropic ─────────────────────────────────────────
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model:      ALLOWED_MODEL,
        max_tokens: MAX_TOKENS,
        stream:     false,
        system: [
          {
            type:          'text',
            text:          SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return res.status(anthropicRes.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await anthropicRes.json();
    const text = data?.content?.[0]?.text;
    if (!text) return res.status(502).json({ error: 'Empty response from Anthropic' });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);

  } catch(e) {
    console.error('Anthropic fetch error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
