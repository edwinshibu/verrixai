export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://verrixai.com';

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

  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;

  try {
    // Verify user token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY }
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData.id) return json({ error: 'Unauthorised' }, 401);

    // Fetch their profile to get the subscription ID
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=stripe_subscription_id,plan`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY } }
    );
    const profiles = await profileRes.json();
    const profile  = profiles?.[0];

    if (!profile?.stripe_subscription_id) {
      return json({ error: 'No active subscription found.' }, 400);
    }
    if (profile.plan === 'free') {
      return json({ error: 'No paid subscription to cancel.' }, 400);
    }

    // Cancel at period end — user keeps access until billing period expires
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${profile.stripe_subscription_id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type':  'application/x-www-form-urlencoded'
        },
        body: 'cancel_at_period_end=true'
      }
    );
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok) throw new Error(stripeData.error?.message || 'Stripe error');

    return json({ success: true, cancel_at: stripeData.cancel_at });

  } catch(err) {
    console.error('Cancel subscription error:', err);
    return json({ error: 'Failed to cancel subscription. Please contact admin@verrixai.com.' }, 500);
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
