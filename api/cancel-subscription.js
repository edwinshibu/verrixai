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

    // Send cancellation-scheduled email to user (best-effort — failure here doesn't block the cancellation)
    try {
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (RESEND_API_KEY && userData.email && periodEnd) {
        const planLabel = profile.plan === 'starter' ? 'Starter' : profile.plan === 'pro' ? 'Pro' : profile.plan === 'pro2' ? 'Pro 2' : profile.plan;
        // Format the period-end date for display (e.g. "Friday, 5 June 2026")
        const endDate = new Date(periodEnd);
        const formattedDate = new Intl.DateTimeFormat('en-AU', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }).format(endDate);
        const subject = `Your VerrixAI subscription will end on ${formattedDate}`;
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding-bottom:32px;"><span style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1A1A18;letter-spacing:-0.3px;">Verrix<span style="color:#B8963E;">AI</span></span></td></tr>
<tr><td style="background:#FFFFFF;border-radius:18px;border:1px solid #E2E0D8;padding:40px 44px;box-shadow:0 4px 24px rgba(26,26,24,0.07);">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;"><div style="width:56px;height:56px;background:#F0EEE8;border-radius:50%;display:inline-block;text-align:center;line-height:56px;font-size:24px;">⌛</div></td></tr></table>
<p style="font-family:Georgia,serif;font-size:24px;font-weight:500;color:#1A1A18;text-align:center;margin:0 0 10px;line-height:1.3;">Cancellation scheduled</p>
<p style="font-size:15px;color:#6B6B62;text-align:center;margin:0 0 28px;line-height:1.65;font-weight:300;">Your VerrixAI ${planLabel} subscription will end on <strong style="color:#1A1A18;">${formattedDate}</strong>. You won't be charged again.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#FAF8F2;border:1px solid #E8E2D2;border-radius:10px;padding:18px 20px;">
<p style="font-size:12px;font-weight:600;color:#1A1A18;margin:0 0 10px;letter-spacing:0.04em;text-transform:uppercase;">Until then</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ You keep full ${planLabel} access</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ Any remaining scans this period are yours to use</p>
<p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">→ After ${formattedDate}, your account moves to the Free plan automatically</p>
</td></tr></table>
<p style="font-size:14px;color:#6B6B62;margin:0 0 28px;line-height:1.7;">Changed your mind? Email us at <a href="mailto:admin@verrixai.com" style="color:#2E5C42;font-weight:500;">admin@verrixai.com</a> before <strong>${formattedDate}</strong> and we'll reverse the cancellation.</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;"><a href="https://verrixai.com/account" style="display:inline-block;background:#1A3A2A;color:#FFFFFF;font-size:14px;font-weight:500;text-decoration:none;padding:13px 32px;border-radius:12px;letter-spacing:0.02em;">View account</a></td></tr></table>
</td></tr>
<tr><td align="center" style="padding-top:24px;"><p style="font-size:11px;color:#B8B8AA;margin:0;line-height:1.6;">You're receiving this because a cancellation was scheduled on your subscription at <a href="https://verrixai.com" style="color:#B8963E;text-decoration:none;">verrixai.com</a>.<br/>Questions? Reply to this email or contact <a href="mailto:admin@verrixai.com" style="color:#B8963E;text-decoration:none;">admin@verrixai.com</a>.</p></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
        const text = `Your VerrixAI ${planLabel} subscription will end on ${formattedDate}. You won't be charged again.\n\nUntil then:\n  - You keep full ${planLabel} access\n  - Any remaining scans this period are yours to use\n  - After ${formattedDate}, your account moves to the Free plan automatically\n\nChanged your mind? Email admin@verrixai.com before ${formattedDate} and we'll reverse the cancellation.\n\nThanks,\nVerrixAI`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'VerrixAI <admin@verrixai.com>',
            to: userData.email,
            subject,
            html,
            text
          })
        });
      }
    } catch (emailErr) {
      // Non-fatal — cancellation already succeeded in Stripe + DB
      console.error('Cancel-scheduled email failed (cancellation still applied):', emailErr);
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
