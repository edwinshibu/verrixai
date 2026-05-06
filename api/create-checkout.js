export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://verrixai.com';

// Permitted origins for CORS — production plus any *.vercel.app preview deploys
function corsOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return ALLOWED_ORIGIN;
  // Allow production, www subdomain, and Vercel preview URLs
  if (origin === ALLOWED_ORIGIN) return origin;
  if (origin === 'https://www.verrixai.com') return origin;
  if (/^https:\/\/verrixai-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  return ALLOWED_ORIGIN; // fallback
}

// Price IDs are loaded from env vars at request time so production and preview
// can use different Stripe environments (live vs sandbox) without code changes.
function getPrices() {
  return {
    starter_monthly: process.env.PRICE_STARTER_MONTHLY,
    starter_annual:  process.env.PRICE_STARTER_ANNUAL,
    pro_monthly:     process.env.PRICE_PRO_MONTHLY,
    pro_annual:      process.env.PRICE_PRO_ANNUAL,
    pro2_monthly:    process.env.PRICE_PRO2_MONTHLY,
    pro2_annual:     process.env.PRICE_PRO2_ANNUAL,
  };
}

export default async function handler(req) {

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  corsOrigin(req),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorised' }, 401, req);
  const token = authHeader.split(' ')[1];

  let body;
  try { body = await req.json(); } catch(e) { return json({ error: 'Invalid JSON' }, 400, req); }

  const { plan, billing } = body || {};
  const priceKey = `${plan}_${billing}`;
  const priceId  = getPrices()[priceKey];
  if (!priceId) return json({ error: 'Invalid plan or billing cycle' }, 400, req);

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

  try {
    // Verify user token with Supabase
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      }
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData.id) return json({ error: 'Unauthorised' }, 401, req);

    // Use the request's origin so checkouts on preview URLs return to preview,
    // and checkouts on production return to production. Falls back to ALLOWED_ORIGIN.
    const origin = req.headers.get('origin') || ALLOWED_ORIGIN;

    // Create Stripe checkout session
    const params = new URLSearchParams({
      'mode':                              'subscription',
      'line_items[0][price]':             priceId,
      'line_items[0][quantity]':          '1',
      'success_url':                      `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':                       `${origin}/?checkout=cancelled`,
      'customer_email':                    userData.email,
      'metadata[user_id]':                userData.id,
      'metadata[plan]':                   plan,
      'metadata[billing]':                billing,
      'subscription_data[metadata][user_id]': userData.id,
      'subscription_data[metadata][plan]':    plan,
      'allow_promotion_codes':            'true',
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) throw new Error(session.error?.message || 'Stripe error');

    return json({ url: session.url }, 200, req);

  } catch(err) {
    console.error('Checkout error:', err);
    return json({ error: 'Failed to create checkout session' }, 500, req);
  }
}

function json(data, status = 200, req = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': req ? corsOrigin(req) : ALLOWED_ORIGIN,
    }
  });
}
