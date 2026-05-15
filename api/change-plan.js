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

const PLAN_SCANS = {
  starter: 50,
  pro:     100,
  pro2:    250,
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

  const { plan: newPlan, billing: requestedBilling } = body || {};
  if (!newPlan || !requestedBilling) return json({ error: 'Missing plan or billing' }, 400, req);

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

    // Fetch profile to get current plan + subscription
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=plan,billing,stripe_subscription_id`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY } }
    );
    const profiles = await profileRes.json();
    const profile  = profiles?.[0];

    if (!profile?.stripe_subscription_id) {
      return json({ error: 'No active subscription found. Please subscribe via the pricing page.' }, 400, req);
    }

    const currentPlan    = profile.plan;
    const currentBilling = profile.billing;

    // Validate: must be a real upgrade path
    if (!isValidUpgrade(currentPlan, newPlan)) {
      return json({ error: 'Invalid plan change. Only upgrades from your current plan are supported.' }, 400, req);
    }

    // Validate: billing cycle must match current (no monthly→annual switching here)
    if (requestedBilling !== currentBilling) {
      return json({ error: 'Billing cycle change not supported. Please contact support.' }, 400, req);
    }

    // Look up the new price ID
    const priceKey = `${newPlan}_${requestedBilling}`;
    const newPriceId = getPrices()[priceKey];
    if (!newPriceId) return json({ error: 'Invalid plan or billing cycle' }, 400, req);

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
      }, isCardError ? 402 : 500, req);
    }

    // Mirror the change to profiles immediately (webhook is the safety net)
    const periodEndRaw =
      updatedSub.items?.data?.[0]?.current_period_end
      ?? updatedSub.current_period_end;
    const periodEnd = periodEndRaw
      ? new Date(periodEndRaw * 1000).toISOString()
      : null;

    const newScansLimit = PLAN_SCANS[newPlan] || 3;

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

    // Send plan-changed email to user (best-effort — failure here doesn't block the upgrade response)
    try {
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (RESEND_API_KEY && userData.email) {
        const oldPlanLabel = currentPlan === 'starter' ? 'Starter' : currentPlan === 'pro' ? 'Pro' : currentPlan === 'pro2' ? 'Pro 2' : currentPlan;
        const newPlanLabel = newPlan === 'starter' ? 'Starter' : newPlan === 'pro' ? 'Pro' : newPlan === 'pro2' ? 'Pro 2' : newPlan;
        // Format the next-renewal date (e.g. "5 June 2026")
        const renewalDate = periodEnd
          ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(periodEnd))
          : null;
        const renewalLine = renewalDate
          ? `Your billing cycle stays the same. Your next renewal is on <strong>${renewalDate}</strong>.`
          : `Your billing cycle stays the same as before.`;
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding-bottom:32px;"><span style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1A1A18;letter-spacing:-0.3px;">Verrix<span style="color:#B8963E;">AI</span></span></td></tr>
<tr><td style="background:#FFFFFF;border-radius:18px;border:1px solid #E2E0D8;padding:40px 44px;box-shadow:0 4px 24px rgba(26,26,24,0.07);">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;"><div style="width:56px;height:56px;background:#EAF2EC;border-radius:50%;display:inline-block;text-align:center;line-height:56px;font-size:24px;">↑</div></td></tr></table>
<p style="font-family:Georgia,serif;font-size:24px;font-weight:500;color:#1A1A18;text-align:center;margin:0 0 10px;line-height:1.3;">You're now on ${newPlanLabel}</p>
<p style="font-size:15px;color:#6B6B62;text-align:center;margin:0 0 28px;line-height:1.65;font-weight:300;">Your VerrixAI subscription has been upgraded from ${oldPlanLabel} to <strong style="color:#2E5C42;">${newPlanLabel}</strong>. The change is effective immediately.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#FAF8F2;border:1px solid #E8E2D2;border-radius:10px;padding:18px 20px;">
<p style="font-size:12px;font-weight:600;color:#1A1A18;margin:0 0 10px;letter-spacing:0.04em;text-transform:uppercase;">What's changed</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ <strong>${newScansLimit} scans</strong> available right now (your counter has been reset)</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ A prorated charge for the rest of this billing period has been applied to your card</p>
<p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">→ ${renewalLine}</p>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:32px;"><a href="https://verrixai.com" style="display:inline-block;background:#1A3A2A;color:#FFFFFF;font-size:15px;font-weight:500;text-decoration:none;padding:15px 40px;border-radius:12px;letter-spacing:0.02em;">Start using ${newPlanLabel} →</a></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E2E0D8;padding-top:20px;">
<p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">View invoices, change billing, or manage your subscription anytime at <a href="https://verrixai.com/account" style="color:#2E5C42;">verrixai.com/account</a>.</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 0 8px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<span style="font-size:11px;color:#6B6B62;">🔒 Zero data retention</span>
<span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
<span style="font-size:11px;color:#6B6B62;">🛡️ End-to-end encrypted</span>
<span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
<span style="font-size:11px;color:#6B6B62;">⚖️ Not legal advice</span>
</td></tr></table></td></tr>
<tr><td align="center" style="padding-top:16px;"><p style="font-size:11px;color:#B8B8AA;margin:0;line-height:1.6;">You're receiving this because you upgraded your subscription at <a href="https://verrixai.com" style="color:#B8963E;text-decoration:none;">verrixai.com</a>.<br/>Questions? Reply to this email or contact <a href="mailto:admin@verrixai.com" style="color:#B8963E;text-decoration:none;">admin@verrixai.com</a>.</p></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
        const text = `You're now on VerrixAI ${newPlanLabel}.\n\nYour subscription has been upgraded from ${oldPlanLabel} to ${newPlanLabel}. The change is effective immediately.\n\nWhat's changed:\n  - ${newScansLimit} scans available right now (your counter has been reset)\n  - A prorated charge for the rest of this billing period has been applied to your card\n  - ${renewalDate ? `Your billing cycle stays the same. Your next renewal is on ${renewalDate}.` : `Your billing cycle stays the same as before.`}\n\nStart using ${newPlanLabel}: https://verrixai.com\n\nView invoices and manage billing: https://verrixai.com/account\n\nThanks,\nVerrixAI`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'VerrixAI <admin@verrixai.com>',
            to: userData.email,
            subject: `You're now on VerrixAI ${newPlanLabel}`,
            html,
            text
          })
        });
      }
    } catch (emailErr) {
      // Non-fatal — upgrade already applied to Stripe + DB
      console.error('Plan-changed email failed (upgrade still applied):', emailErr);
    }

    return json({
      success:            true,
      plan:               newPlan,
      scans_limit:        newScansLimit,
      current_period_end: periodEnd
    }, 200, req);

  } catch(err) {
    console.error('Change plan error:', err);
    return json({ error: 'Failed to change plan. Please try again or contact admin@verrixai.com.' }, 500, req);
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
