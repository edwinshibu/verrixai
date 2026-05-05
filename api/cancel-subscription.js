export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://verrixai.com';

// Permitted origins for CORS — production plus any *.vercel.app preview deploys
function corsOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return ALLOWED_ORIGIN;
  if (origin === ALLOWED_ORIGIN) return origin;
  if (origin === 'https://www.verrixai.com') return origin;
  if (/^https:\/\/verrixai-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  return ALLOWED_ORIGIN;
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
    if (!userRes.ok || !userData.id) return json({ error: 'Unauthorised' }, 401, req);

    // Fetch their profile to get the subscription ID
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=stripe_subscription_id,plan`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY } }
    );
    const profiles = await profileRes.json();
    const profile  = profiles?.[0];

    if (!profile?.stripe_subscription_id) {
      return json({ error: 'No active subscription found.' }, 400, req);
    }
    if (profile.plan === 'free') {
      return json({ error: 'No paid subscription to cancel.' }, 400, req);
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

    // Mirror cancellation state to profiles immediately (webhook is the safety net)
    const periodEndRaw =
      stripeData.items?.data?.[0]?.current_period_end  // Stripe API 2025-03-31+
      ?? stripeData.current_period_end;                // Legacy fallback
    const periodEnd = periodEndRaw
      ? new Date(periodEndRaw * 1000).toISOString()
      : null;

    try {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey':        SUPABASE_SERVICE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify({
          cancel_at_period_end: true,
          current_period_end:   periodEnd
        })
      });
    } catch (dbErr) {
      // Non-fatal — webhook will reconcile
      console.error('Profile update failed (webhook will retry):', dbErr);
    }

    return json({ success: true, cancel_at: stripeData.cancel_at, current_period_end: periodEnd }, 200, req);

  } catch(err) {
    console.error('Cancel subscription error:', err);
    return json({ error: 'Failed to cancel subscription. Please contact admin@verrixai.com.' }, 500, req);
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
