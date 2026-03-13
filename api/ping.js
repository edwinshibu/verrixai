export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://verrixai.com';

export default function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      }
    });
  }

  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    status: 200,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Cache-Control':               'no-store',
    }
  });
}
