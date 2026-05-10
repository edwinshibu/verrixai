// Serverless function (Node.js runtime) — maxDuration: 60 in vercel.json
// Uses Node.js req/res style for full compatibility with Vercel Serverless.

const ALLOWED_ORIGIN  = 'https://verrixai.com';
const MAX_TEXT_LENGTH = 60000;
const ALLOWED_MODEL   = 'claude-sonnet-4-6';
const MAX_TOKENS      = 4000;

// ── CORS ───────────────────────────────────────────────────
// Permitted origins — production plus any *.vercel.app preview deploys
function corsOrigin(req) {
  const origin = req.headers['origin'];
  if (!origin) return ALLOWED_ORIGIN;
  if (origin === ALLOWED_ORIGIN) return origin;
  if (origin === 'https://www.verrixai.com') return origin;
  if (/^https:\/\/verrixai-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  return ALLOWED_ORIGIN;
}

// ── Rate limiting ──────────────────────────────────────────
// In-memory per serverless instance. Not shared across instances,
// but provides meaningful protection against single-source abuse.
const RATE_LIMIT_AUTH   = 30;
const RATE_WINDOW_MS    = 60 * 1000; // 1 minute

const rateLimitStore = new Map();

function checkRateLimit(key, maxRequests) {
  const now    = Date.now();
  const record = rateLimitStore.get(key) || { count: 0, resetAt: now + RATE_WINDOW_MS };

  if (now > record.resetAt) {
    record.count   = 0;
    record.resetAt = now + RATE_WINDOW_MS;
  }

  record.count++;
  rateLimitStore.set(key, record);
  return record.count <= maxRequests;
}

// Periodically purge expired entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) rateLimitStore.delete(key);
  }
}, 60_000);

// ── Supabase helpers ───────────────────────────────────────
async function verifyTokenAndGetProfile(token) {
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;

  // 1. Verify the JWT and get the user object from Supabase Auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey':        SUPABASE_SERVICE_KEY
    }
  });
  if (!userRes.ok) return null;

  const user = await userRes.json();
  if (!user?.id) return null;

  // 2. Fetch the user's profile (scans_used + scans_limit) using service key
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=scans_used,scans_limit&id=eq.${user.id}`,
    {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey':        SUPABASE_SERVICE_KEY
      }
    }
  );
  if (!profileRes.ok) return null;

  const profiles = await profileRes.json();
  if (!profiles?.[0]) return null;

  return {
    userId:      user.id,
    scans_used:  profiles[0].scans_used  ?? 0,
    scans_limit: profiles[0].scans_limit ?? 3
  };
}

// ── System prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `You are a document analyst. You MUST respond ONLY with a single valid JSON object — no markdown, no preamble, no text outside the JSON.

Analyse the document and return this JSON:
{"IS_LEGAL":true/false,"SUMMARY":"...","RISKS":[{"level":"HIGH","title":"...","desc":"..."}],"RISKS_TRUNCATED":0,"KEY_POINTS":["..."],"SIMPLIFIED":"..."}

IS_LEGAL: true if this is a legal/contractual/business document. false for anything else (CV, academic, personal docs etc).

RISKS must be a JSON array of objects with keys: level (HIGH/MEDIUM/LOW), title (string), desc (string).

Severity guidance:
- HIGH: material concerns — significant financial exposure, unusual or onerous obligations, missing critical protections, ambiguous terms with real consequence. Use sparingly; typical contracts have 0–4 HIGH risks.
- MEDIUM: notable but standard concerns worth flagging.
- LOW: minor points or boilerplate worth knowing about.

Cap: include up to 8 items total. EXCEPTION: ALL HIGH-severity risks must be included even if this exceeds 8 (hard ceiling 15 HIGH for very complex documents). After listing all HIGH risks, fill remaining slots up to 8 with the most material MEDIUM and LOW. Minimum 3 items if the document has any concerns.

RISKS_TRUNCATED: integer count of additional MEDIUM/LOW-severity considerations identified in the document but not included in the RISKS array (0 if RISKS contains everything material). Do not count HIGH risks here — those are always fully included in RISKS.
KEY_POINTS must be a JSON array of strings. Include 4–7 items.
SUMMARY must be a plain string, 3–5 sentences.
SIMPLIFIED must be a plain string, plain-English rewrite, 3–5 sentences, no jargon.

CRITICAL: Always populate every requested field with real analysis. Never leave fields empty or null. If not a legal document, still analyse what the document contains and note what type it is.`;

const KEY_MAP = { summary: 'SUMMARY', risks: 'RISKS', keypoints: 'KEY_POINTS', simplify: 'SIMPLIFIED' };

// ── Handler ────────────────────────────────────────────────
export default async function handler(req, res) {

  // CORS headers on every response
  res.setHeader('Access-Control-Allow-Origin',  corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Keepalive — GET returns instantly, keeps function warm
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Extract client IP ──────────────────────────────────
  const ip = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );

  // ── Auth: extract JWT if present ───────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  let profile = null;
  if (token) {
    profile = await verifyTokenAndGetProfile(token);
    // If a token was provided but is invalid, reject — don't silently fall back
    if (!profile) {
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }
  }

  // ── Require authentication ─────────────────────────────
  if (!token) {
    return res.status(401).json({ error: 'Sign in to use VerrixAI.' });
  }

  // ── Rate limiting (authenticated users only) ───────────
  if (!checkRateLimit(`auth:${profile.userId}`, RATE_LIMIT_AUTH)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  // ── Scan limit check (authenticated users only) ────────
  if (profile) {
    if (profile.scans_used >= profile.scans_limit) {
      return res.status(403).json({ error: 'scan_limit_reached' });
    }
  }

  // ── Validate API key ───────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // ── Parse body ─────────────────────────────────────────
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

  // ── Validate content ───────────────────────────────────
  if (typeof rawContent !== 'string') {
    return res.status(400).json({ error: 'Invalid content format.' });
  }
  if (rawContent.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: 'Document too large. Please reduce the size and try again.' });
  }

  // ── Build user message ─────────────────────────────────
  const requestedKeys = options.length
    ? ['IS_LEGAL', ...options.map(o => KEY_MAP[o]).filter(Boolean)]
    : ['IS_LEGAL', 'SUMMARY', 'RISKS', 'KEY_POINTS', 'SIMPLIFIED'];
  // If RISKS is requested, also request RISKS_TRUNCATED
  if (requestedKeys.includes('RISKS')) requestedKeys.push('RISKS_TRUNCATED');
  const dynamicInstruction = `Only include these keys in your JSON response: ${requestedKeys.join(', ')}.`;

  // Prompt injection boundary — treats all user content as data, never instructions
  const userContent = `${dynamicInstruction}\n\n--- DOCUMENT START ---\n${rawContent}\n--- DOCUMENT END ---`;

  // ── Call Anthropic ─────────────────────────────────────
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      ALLOWED_MODEL,
        max_tokens: MAX_TOKENS,
        stream:     false,
        system:     SYSTEM_PROMPT,
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

  } catch (e) {
    console.error('Anthropic fetch error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
