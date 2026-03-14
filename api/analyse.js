// Serverless function — supports full 60s maxDuration on Vercel Pro.
// Edge runtime was removed: Edge has a hard 25s CPU limit regardless of plan,
// which was causing all analysis timeouts.

const ALLOWED_ORIGIN  = 'https://verrixai.com';
const MAX_TEXT_LENGTH = 60000;
const ALLOWED_MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 4000;

// ── Cached system prompt ────────────────────────────────────
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

export default async function handler(req) {

  // ── CORS preflight ─────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  // ── Keepalive ping — GET returns instantly, keeps function warm ──
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Cache-Control':               'no-store',
      }
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'API key not configured' }, 500);

  // ── Parse body ─────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch(e) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let rawContent;
  let options = [];

  if (body?.content !== undefined) {
    rawContent = body.content;
    options    = Array.isArray(body.options) ? body.options : [];
  } else if (body?.messages && Array.isArray(body.messages)) {
    const userMessage = body.messages.find(m => m.role === 'user');
    if (!userMessage) return json({ error: 'No user message provided.' }, 400);
    rawContent = userMessage.content;
  } else {
    return json({ error: 'Invalid request format.' }, 400);
  }

  // ── Validate content ───────────────────────────────────────
  if (typeof rawContent === 'string') {
    if (rawContent.length > MAX_TEXT_LENGTH) {
      return json({ error: 'Document too large. Please reduce the size and try again.' }, 400);
    }
  } else if (Array.isArray(rawContent)) {
    const textPart = rawContent.find(p => p.type === 'text');
    if (textPart?.text?.length > MAX_TEXT_LENGTH) {
      return json({ error: 'Document too large. Please reduce the size and try again.' }, 400);
    }
    const docPart = rawContent.find(p => p.type === 'document');
    if (docPart) {
      if (!docPart.source?.data || typeof docPart.source.data !== 'string') {
        return json({ error: 'Invalid document format.' }, 400);
      }
      if (docPart.source.data.length > 13_000_000) {
        return json({ error: 'Document too large.' }, 400);
      }
      if (docPart.source.media_type !== 'application/pdf') {
        return json({ error: 'Only PDF documents are supported.' }, 400);
      }
    }
  } else {
    return json({ error: 'Invalid content format.' }, 400);
  }

  // ── Build user message ─────────────────────────────────────
  const requestedKeys = options.length
    ? ['IS_LEGAL', ...options.map(o => KEY_MAP[o]).filter(Boolean)]
    : ['IS_LEGAL', 'SUMMARY', 'RISKS', 'KEY_POINTS', 'SIMPLIFIED'];
  const dynamicInstruction = `Only include these keys in your JSON response: ${requestedKeys.join(', ')}.`;

  let userContent;
  if (typeof rawContent === 'string') {
    userContent = `${dynamicInstruction}\n\nDOCUMENT:\n"""\n${rawContent}\n"""`;
  } else {
    const docBlocks = rawContent.filter(p => p.type !== 'text');
    userContent = [...docBlocks, { type: 'text', text: dynamicInstruction }];
  }

  // ── Call Anthropic — no streaming ──────────────────────────
  // Non-streaming is more reliable across all network conditions.
  // The full response arrives as one complete JSON object.
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
    return json({ error: err.error?.message || 'Anthropic API error' }, anthropicRes.status);
  }

  const data = await anthropicRes.json();
  const text = data?.content?.[0]?.text;
  if (!text) return json({ error: 'Empty response from Anthropic' }, 502);

  // Return the raw text — client parses JSON from it
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type':                'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Cache-Control':               'no-store',
    }
  });
}

// ── Helper ─────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    }
  });
}
