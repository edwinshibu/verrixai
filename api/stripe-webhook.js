const PLAN_SCANS = {
  starter: 50,
  pro:     300,
  pro2:    700,
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

        const scansLimit = PLAN_SCANS[plan] || 5;

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
            current_period_end: null,
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
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'VerrixAI <admin@verrixai.com>',
              to: userData.email,
              subject: `Welcome to VerrixAI ${planLabel}!`,
              html: `<div style="font-family:'Georgia',serif;max-width:540px;margin:0 auto;padding:40px 24px;color:#1A1A18;background:#F7F6F2;"><div style="font-size:22px;font-weight:600;margin-bottom:24px;">Verrix<span style="color:#B8963E;">AI</span></div><h2 style="font-size:22px;font-weight:500;margin-bottom:12px;">You're on ${planLabel}!</h2><p style="color:#6B6B62;font-size:15px;line-height:1.7;margin-bottom:16px;">Your ${planLabel} ${billingLabel} subscription is now active. You have <strong>${scansLimit} scans</strong> available this month.</p><p style="margin-bottom:24px;"><a href="https://verrixai.com" style="background:#1A3A2A;color:white;padding:12px 24px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500;">Start analysing →</a></p><p style="color:#6B6B62;font-size:13px;line-height:1.7;">To manage your subscription, visit your account page at <a href="https://verrixai.com/account" style="color:#2E5C42;">verrixai.com/account</a>.</p></div>`,
              text: `You're now on VerrixAI ${planLabel}! Your ${billingLabel} subscription is active with ${scansLimit} scans available. Visit verrixai.com to get started.`
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

        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
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
        const scansLimit = PLAN_SCANS[plan] || 5;
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
            scans_limit: 5,
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
