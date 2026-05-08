const PLAN_SCANS = {
  starter: 50,
  pro:     100,
  pro2:    250,
};

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyStripeSignature(body, signature, secret) {
  const parts = Object.fromEntries(signature.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const computedSig = toHex(sig);
  if (computedSig !== expectedSig) throw new Error('Invalid signature');
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) throw new Error('Timestamp too old');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['stripe-signature'];
  if (!signature) return res.status(400).json({ error: 'Missing signature' });

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL          = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  let rawBody = '';
  try {
    // Read raw body for signature verification
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBody = Buffer.concat(chunks).toString('utf8');
    await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch(e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);
  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'apikey': SUPABASE_SERVICE_KEY,
    'Prefer': 'return=minimal'
  };

  try {
    switch (event.type) {

      // ── Checkout completed → activate subscription ────────────
      case 'checkout.session.completed': {
        const session  = event.data.object;
        const userId   = session.metadata?.user_id;
        const plan     = session.metadata?.plan;
        const billing  = session.metadata?.billing;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        if (!userId || !plan) break;

        const scansLimit = PLAN_SCANS[plan] || 3;

        // Fetch the subscription so we can store current_period_end immediately
        // (Stripe doesn't reliably fire customer.subscription.updated right after checkout)
        let periodEnd = null;
        if (subscriptionId) {
          try {
            const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
            const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
            });
            const sub = await subRes.json();
            if (subRes.ok) {
              const periodEndRaw =
                sub.items?.data?.[0]?.current_period_end  // Stripe API 2025-03-31+
                ?? sub.current_period_end;                // Legacy fallback
              periodEnd = periodEndRaw
                ? new Date(periodEndRaw * 1000).toISOString()
                : null;
            }
          } catch (e) {
            console.error('Could not fetch subscription period end (non-fatal):', e);
          }
        }

        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({
            plan,
            billing,
            scans_limit: scansLimit,
            scans_used: 0,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            cancel_at_period_end: false,
            current_period_end: periodEnd,
          })
        });

        // Send welcome email via Resend
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
          headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY }
        });
        const userData = await userRes.json();
        if (userData.email) {
          const planLabel = plan === 'starter' ? 'Starter' : plan === 'pro' ? 'Pro' : 'Pro 2';
          const billingLabel = billing === 'annual' ? 'annual' : 'monthly';
          const isAnnual = billing === 'annual';
          // Annual savings vs monthly (12 × monthly - annual price), all in AUD
          const annualSavings = plan === 'starter' ? 12 : plan === 'pro' ? 22 : plan === 'pro2' ? 36 : 0;
          const billingNote = isAnnual
            ? `Your <strong>annual</strong> subscription gives you ${scansLimit} scans every month, and you're saving roughly <strong>A$${annualSavings}</strong> compared to paying monthly.`
            : `Your <strong>monthly</strong> subscription resets your ${scansLimit} scans on the same day each month.`;
          const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding-bottom:32px;"><span style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1A1A18;letter-spacing:-0.3px;">Verrix<span style="color:#B8963E;">AI</span></span></td></tr>
<tr><td style="background:#FFFFFF;border-radius:18px;border:1px solid #E2E0D8;padding:40px 44px;box-shadow:0 4px 24px rgba(26,26,24,0.07);">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;"><div style="width:56px;height:56px;background:#EAF2EC;border-radius:50%;display:inline-block;text-align:center;line-height:56px;font-size:24px;">✦</div></td></tr></table>
<p style="font-family:Georgia,serif;font-size:24px;font-weight:500;color:#1A1A18;text-align:center;margin:0 0 10px;line-height:1.3;">You're on ${planLabel}</p>
<p style="font-size:15px;color:#6B6B62;text-align:center;margin:0 0 28px;line-height:1.65;font-weight:300;">Thanks for upgrading. Your ${planLabel} ${billingLabel} subscription is now active, and you have <strong style="color:#2E5C42;">${scansLimit} scans</strong> available this month.</p>
<p style="font-size:14px;color:#6B6B62;margin:0 0 28px;line-height:1.7;">${billingNote}</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:32px;"><a href="https://verrixai.com" style="display:inline-block;background:#1A3A2A;color:#FFFFFF;font-size:15px;font-weight:500;text-decoration:none;padding:15px 40px;border-radius:12px;letter-spacing:0.02em;">Start analysing →</a></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#FAF8F2;border:1px solid #E8E2D2;border-radius:10px;padding:18px 20px;">
<p style="font-size:12px;font-weight:600;color:#1A1A18;margin:0 0 10px;letter-spacing:0.04em;text-transform:uppercase;">Try it on something real</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ Your next employment contract or freelance agreement</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ The terms &amp; conditions of any service you use</p>
<p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">→ Lease agreements, NDAs, vendor MSAs</p>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#EAF5EE;border:1px solid #C5D8C8;border-radius:10px;padding:14px 18px;">
<p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">🔒 <strong style="color:#1A1A18;">Your privacy:</strong> documents you upload are processed in real time and never stored on our servers. Only the analysis results are saved to your account.</p>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E2E0D8;padding-top:20px;">
<p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">Manage or cancel your subscription anytime at <a href="https://verrixai.com/account" style="color:#2E5C42;">verrixai.com/account</a>. We make leaving as easy as joining.</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 0 8px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<span style="font-size:11px;color:#6B6B62;">🔒 Zero data retention</span>
<span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
<span style="font-size:11px;color:#6B6B62;">🛡️ End-to-end encrypted</span>
<span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
<span style="font-size:11px;color:#6B6B62;">⚖️ Not legal advice</span>
</td></tr></table></td></tr>
<tr><td align="center" style="padding-top:16px;"><p style="font-size:11px;color:#B8B8AA;margin:0;line-height:1.6;">You're receiving this because you subscribed at <a href="https://verrixai.com" style="color:#B8963E;text-decoration:none;">verrixai.com</a>.<br/>Questions? Reply to this email or contact <a href="mailto:admin@verrixai.com" style="color:#B8963E;text-decoration:none;">admin@verrixai.com</a>.</p></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
          const text = `You're on VerrixAI ${planLabel}.\n\nYour ${planLabel} ${billingLabel} subscription is now active. You have ${scansLimit} scans available this month.\n\nStart analysing: https://verrixai.com\n\nManage or cancel anytime: https://verrixai.com/account\n\nYour privacy: documents you upload are never stored on our servers. Only analysis results are saved.\n\n— VerrixAI`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'VerrixAI <admin@verrixai.com>',
              to: userData.email,
              subject: `Welcome to VerrixAI ${planLabel}`,
              html,
              text
            })
          });
        }
        break;
      }

      // ── Subscription updated → cancellation pending OR renewal ──
      case 'customer.subscription.updated': {
        const sub    = event.data.object;
        const userId = sub.metadata?.user_id;
        const plan   = sub.metadata?.plan;
        if (!userId || !plan) break;

        const periodEndRaw =
          sub.items?.data?.[0]?.current_period_end  // Stripe API 2025-03-31+
          ?? sub.current_period_end;                // Legacy fallback
        const periodEnd = periodEndRaw
          ? new Date(periodEndRaw * 1000).toISOString()
          : null;

        // If cancel_at_period_end was just set, store cancellation state — don't reset scans
        if (sub.cancel_at_period_end) {
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
              cancel_at_period_end: true,
              current_period_end:   periodEnd
            })
          });
          break;
        }

        // Otherwise: active renewal — reset scans, clear any stale cancel flag
        const scansLimit = PLAN_SCANS[plan] || 3;
        const status = sub.status;

        if (status === 'active') {
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
            method: 'PATCH',
            headers: adminHeaders,
            body: JSON.stringify({
              scans_limit:          scansLimit,
              scans_used:           0,
              plan,
              cancel_at_period_end: false,
              current_period_end:   periodEnd
            })
          });
        }
        break;
      }

      // ── Subscription cancelled → downgrade to free ────────────
      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const userId = sub.metadata?.user_id;
        if (!userId) break;

        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({
            plan: 'free',
            scans_limit: 3,
            scans_used: 0,
            stripe_subscription_id: null,
            cancel_at_period_end: false,
            current_period_end: null,
          })
        });

        // Notify admin
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'VerrixAI <admin@verrixai.com>',
            to: 'admin@verrixai.com',
            subject: `Subscription cancelled: user ${userId}`,
            text: `User ${userId} has cancelled their VerrixAI subscription. They have been downgraded to the free plan.`
          })
        });
        break;
      }
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
