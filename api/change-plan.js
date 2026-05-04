export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://verrixai.com';

const PRICES = {
  starter_monthly: 'price_1TB3b7HHwf5U84kmThqcLbaj',
  starter_annual:  'price_1TB3bUHHwf5U84kmAKlQ6mNE',
  pro_monthly:     'price_1T9lADHHwf5U84kmve42m93y',
  pro_annual:      'price_1T9lB6HHwf5U84kmXzEJv35z',
  pro2_monthly:    'price_1T9lBTHHwf5U84kmR25IuOPk',
  pro2_annual:     'price_1T9lBuHHwf5U84kmMjEgqQ9o',
};

const PLAN_SCANS = {
  starter: 50,
  pro:     300,
  pro2:    700,
};

// Permitted upgrade paths (no downgrades, no same-plan moves)
const UPGRADE_PATHS = {
  starter: ['pro', 'pro2'],
  pro:     ['pro2'],
  // pro2 has no upgrades available
};

function isValidUpgrade(currentPlan, requestedPlan) {
  return UPGRADE_PATHS[currentPlan]?.includes(requestedPlan) === true;
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

  const { plan: newPlan, billing: requestedBilling } = body || {};
  if (!newPlan || !requestedBilling) return json({ error: 'Missing plan or billing' }, 400);

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

    // Fetch profile to get current plan + subscription
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=plan,billing,stripe_subscription_id`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY } }
    );
    const profiles = await profileRes.json();
    const profile  = profiles?.[0];

    if (!profile?.stripe_subscription_id) {
      return json({ error: 'No active subscription found. Please subscribe via the pricing page.' }, 400);
    }

    const currentPlan    = profile.plan;
    const currentBilling = profile.billing;

    // Validate: must be a real upgrade path
    if (!isValidUpgrade(currentPlan, newPlan)) {
      return json({ error: 'Invalid plan change. Only upgrades from your current plan are supported.' }, 400);
    }

    // Validate: billing cycle must match current (no monthly→annual switching here)
    if (requestedBilling !== currentBilling) {
      return json({ error: 'Billing cycle change not supported. Please contact support.' }, 400);
    }

    // Look up the new price ID
    const priceKey = `${newPlan}_${requestedBilling}`;
    const newPriceId = PRICES[priceKey];
    if (!newPriceId) return json({ error: 'Invalid plan or billing cycle' }, 400);

    // Fetch existing subscription to get the item ID we need to swap
    const subFetchRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${profile.stripe_subscription_id}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const existingSub = await subFetchRes.json();
    if (!subFetchRes.ok) throw new Error(existingSub.error?.message || 'Could not fetch subscription');

    const existingItemId = existingSub.items?.data?.[0]?.id;
    if (!existingItemId) throw new Error('Subscription has no items');

    // Update the subscription: swap the price, update metadata, charge prorated difference now,
    // and silently clear any pending cancellation (user committed by upgrading)
    const updateParams = new URLSearchParams({
      'items[0][id]':              existingItemId,
      'items[0][price]':           newPriceId,
      'metadata[plan]':            newPlan,
      'metadata[user_id]':         userData.id,
      'proration_behavior':        'always_invoice',
      'cancel_at_period_end':      'false',
      'payment_behavior':          'error_if_incomplete', // surface card failures immediately
    });

    const updateRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${profile.stripe_subscription_id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type':  'application/x-www-form-urlencoded'
        },
        body: updateParams.toString()
      }
    );
    const updatedSub = await updateRes.json();
    if (!updateRes.ok) {
      // Friendly error for card decline on proration charge
      const stripeMsg = updatedSub.error?.message || 'Stripe error';
      const isCardError = updatedSub.error?.type === 'card_error';
      return json({
        error: isCardError
          ? `Payment failed: ${stripeMsg}. Please update your payment method and try again.`
          : 'Failed to upgrade plan. Please try again or contact admin@verrixai.com.'
      }, isCardError ? 402 : 500);
    }

    // Mirror the change to profiles immediately (webhook is the safety net)
    const periodEndRaw =
      updatedSub.items?.data?.[0]?.current_period_end
      ?? updatedSub.current_period_end;
    const periodEnd = periodEndRaw
      ? new Date(periodEndRaw * 1000).toISOString()
      : null;

    const newScansLimit = PLAN_SCANS[newPlan] || 5;

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
          plan:                 newPlan,
          scans_limit:          newScansLimit,
          scans_used:           0,
          cancel_at_period_end: false,
          current_period_end:   periodEnd
        })
      });
    } catch (dbErr) {
      // Non-fatal — webhook will reconcile
      console.error('Profile update failed (webhook will retry):', dbErr);
    }

    return json({
      success:            true,
      plan:               newPlan,
      scans_limit:        newScansLimit,
      current_period_end: periodEnd
    });

  } catch(err) {
    console.error('Change plan error:', err);
    return json({ error: 'Failed to change plan. Please try again or contact admin@verrixai.com.' }, 500);
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
