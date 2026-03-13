export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN  = 'https://verrixai.com';
const MAX_TEXT_LENGTH = 60000;
const ALLOWED_MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 4000;

export default async function handler(req) {

  // ── CORS preflight ─────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
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

  if (!body?.messages || !Array.isArray(body.messages)) {
    return json({ error: 'Invalid request format.' }, 400);
  }

  const userMessage = body.messages.find(m => m.role === 'user');
  if (!userMessage) return json({ error: 'No user message provided.' }, 400);

  const userContent = userMessage.content;

  // ── Validate content ───────────────────────────────────────
  if (typeof userContent === 'string') {
    if (userContent.length > MAX_TEXT_LENGTH) {
      return json({ error: 'Document too large. Please reduce the size and try again.' }, 400);
    }
  } else if (Array.isArray(userContent)) {
    const textPart = userContent.find(p => p.type === 'text');
    if (textPart?.text?.length > MAX_TEXT_LENGTH) {
      return json({ error: 'Document too large. Please reduce the size and try again.' }, 400);
    }
    const docPart = userContent.find(p => p.type === 'document');
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

  // ── Call Anthropic with streaming ──────────────────────────
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
      stream:     true,
      messages:   [{ role: 'user', content: userContent }]
    })
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.json().catch(() => ({}));
    return json({ error: err.error?.message || 'Anthropic API error' }, anthropicRes.status);
  }

  // ── Transform SSE stream → plain text stream ───────────────
  // Extract only the text deltas and stream them straight to the browser
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                controller.enqueue(new TextEncoder().encode(parsed.delta.text));
              }
            } catch(e) {
              // Ignore malformed SSE lines
            }
          }
        }
      } catch(e) {
        console.error('Stream read error:', e);
      } finally {
        controller.close();
      }
    }
  });

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type':                'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Cache-Control':               'no-cache',
      'X-Accel-Buffering':           'no',
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
