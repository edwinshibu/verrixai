export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://verrixai.com';

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
        'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorised' }, 401);
  const token = authHeader.split(' ')[1];

  let body;
  try { body = await req.json(); } catch(e) { return json({ error: 'Invalid JSON' }, 400); }

  const { plan, billing } = body || {};
  const priceKey = `${plan}_${billing}`;
  const priceId  = getPrices()[priceKey];
  if (!priceId) return json({ error: 'Invalid plan or billing cycle' }, 400);

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
    if (!userRes.ok || !userData.id) return json({ error: 'Unauthorised' }, 401);

    // Create Stripe checkout session
    const params = new URLSearchParams({
      'mode':                              'subscription',
      'line_items[0][price]':             priceId,
      'line_items[0][quantity]':          '1',
      'success_url':                      `https://verrixai.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':                       `https://verrixai.com/?checkout=cancelled`,
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

    return json({ url: session.url });

  } catch(err) {
    console.error('Checkout error:', err);
    return json({ error: 'Failed to create checkout session' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    }
  });
}
