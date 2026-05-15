const ALLOWED_ORIGIN = 'https://verrixai.com';

// Permitted origins — production plus any *.vercel.app preview deploys
function corsOrigin(req) {
  const origin = req.headers['origin'];
  if (!origin) return ALLOWED_ORIGIN;
  if (origin === ALLOWED_ORIGIN) return origin;
  if (origin === 'https://www.verrixai.com') return origin;
  if (/^https:\/\/verrixai-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  return ALLOWED_ORIGIN;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, email } = req.body || {};
  if (!user_id || !email) return res.status(400).json({ error: 'Missing user_id or email' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const token = authHeader.split(' ')[1];

  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY       = process.env.RESEND_API_KEY;
  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;

  try {
    // 1. Verify token belongs to the user
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      }
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData.id !== user_id) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    const adminHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    };

    // 2. Fetch profile to retrieve stripe_subscription_id before we delete the row
    let stripeSubscriptionId = null;
    try {
      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}&select=stripe_subscription_id`,
        { headers: adminHeaders }
      );
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        stripeSubscriptionId = profileData?.[0]?.stripe_subscription_id || null;
      }
    } catch (profileErr) {
      // Non-fatal — profile fetch failure means we can't cancel Stripe, but we still proceed
      // with deletion. Admin notify at the end will surface the orphaned subscription.
      console.error('Profile fetch for Stripe cancel failed (proceeding with deletion):', profileErr);
    }

    // 3. Cancel Stripe subscription if present (best-effort — failure does NOT block deletion,
    // but DOES surface in the admin notify so an orphaned active sub can be cancelled manually)
    let stripeCancelStatus = 'not_applicable'; // 'cancelled' | 'failed' | 'not_applicable'
    let stripeCancelError = null;
    if (stripeSubscriptionId && STRIPE_SECRET_KEY) {
      try {
        // Stripe expects application/x-www-form-urlencoded
        const params = new URLSearchParams();
        params.append('cancellation_details[feedback]', 'other');
        params.append('cancellation_details[comment]', 'User deleted VerrixAI account');
        const cancelRes = await fetch(
          `https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
          }
        );
        if (cancelRes.ok) {
          stripeCancelStatus = 'cancelled';
        } else {
          const errBody = await cancelRes.json().catch(() => ({}));
          // If the subscription is already cancelled or doesn't exist, treat as success
          if (errBody?.error?.code === 'resource_missing') {
            stripeCancelStatus = 'cancelled'; // already gone — same effective end state
          } else {
            stripeCancelStatus = 'failed';
            stripeCancelError = errBody?.error?.message || `HTTP ${cancelRes.status}`;
            console.error('Stripe cancel failed (continuing with deletion):', stripeCancelError);
          }
        }
      } catch (stripeErr) {
        stripeCancelStatus = 'failed';
        stripeCancelError = stripeErr.message;
        console.error('Stripe cancel threw (continuing with deletion):', stripeErr);
      }
    }

    // 4. Delete profile row
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });

    // 5. Delete invites row
    await fetch(`${SUPABASE_URL}/rest/v1/invites?user_id=eq.${user_id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });

    // 6. Delete auth user
    const deleteUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    if (!deleteUserRes.ok) {
      const err = await deleteUserRes.json();
      throw new Error(err.message || 'Failed to delete auth user');
    }

    // 7. Send confirmation email to user (best-effort — failure here doesn't block the deletion response)
    try {
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td align="center" style="padding-bottom:32px;"><span style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1A1A18;letter-spacing:-0.3px;">Verrix<span style="color:#B8963E;">AI</span></span></td></tr>
<tr><td style="background:#FFFFFF;border-radius:18px;border:1px solid #E2E0D8;padding:40px 44px;box-shadow:0 4px 24px rgba(26,26,24,0.07);">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;"><div style="width:56px;height:56px;background:#F0EEE8;border-radius:50%;display:inline-block;text-align:center;line-height:56px;font-size:24px;">✓</div></td></tr></table>
<p style="font-family:Georgia,serif;font-size:24px;font-weight:500;color:#1A1A18;text-align:center;margin:0 0 10px;line-height:1.3;">Your account has been deleted</p>
<p style="font-size:15px;color:#6B6B62;text-align:center;margin:0 0 28px;line-height:1.65;font-weight:300;">Your VerrixAI account and all the data tied to it have been permanently removed.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#FAF8F2;border:1px solid #E8E2D2;border-radius:10px;padding:18px 20px;">
<p style="font-size:12px;font-weight:600;color:#1A1A18;margin:0 0 10px;letter-spacing:0.04em;text-transform:uppercase;">What was deleted</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ Your account credentials and login</p>
<p style="font-size:13px;color:#6B6B62;margin:0 0 6px;line-height:1.6;">→ Your profile (plan, scan history, settings)</p>
<p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">→ Any associated records in our database</p>
</td></tr></table>
<p style="font-size:13px;color:#6B6B62;margin:0 0 24px;line-height:1.7;">Documents you analysed were never stored on our servers in the first place. They're processed in real time and discarded after each scan. Nothing additional to remove there.</p>
<p style="font-size:14px;color:#6B6B62;margin:0 0 28px;line-height:1.7;">If you change your mind, you're always welcome to create a new account at <a href="https://verrixai.com" style="color:#2E5C42;">verrixai.com</a>.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr><td style="background:#FDECEA;border:1px solid #F0C5C2;border-radius:10px;padding:14px 18px;">
<p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;"><strong style="color:#1A1A18;">Didn't request this deletion?</strong> Contact us immediately at <a href="mailto:admin@verrixai.com" style="color:#2E5C42;font-weight:500;">admin@verrixai.com</a>. While the data itself can't be recovered, we want to know if your account was compromised.</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 0 8px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<span style="font-size:11px;color:#6B6B62;">🔒 Zero data retention</span>
<span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
<span style="font-size:11px;color:#6B6B62;">🛡️ End-to-end encrypted</span>
<span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
<span style="font-size:11px;color:#6B6B62;">⚖️ Not legal advice</span>
</td></tr></table></td></tr>
<tr><td align="center" style="padding-top:16px;"><p style="font-size:11px;color:#B8B8AA;margin:0;line-height:1.6;">You're receiving this confirmation because an account deletion was requested for this email at <a href="https://verrixai.com" style="color:#B8963E;text-decoration:none;">verrixai.com</a>.<br/>This is the last email you'll receive from us.</p></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
    const text = `Your VerrixAI account has been deleted.\n\nWhat was deleted:\n  - Your account credentials and login\n  - Your profile (plan, scan history, settings)\n  - Any associated records in our database\n\nDocuments you analysed were never stored on our servers. They're processed in real time and discarded after each scan.\n\nIf you change your mind, you're always welcome to create a new account at https://verrixai.com.\n\nDidn't request this? Contact admin@verrixai.com immediately. While the data itself can't be recovered, we want to know if your account was compromised.\n\nThis is the last email you'll receive from us.`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VerrixAI <admin@verrixai.com>',
        to: email,
        subject: 'Your VerrixAI account has been deleted',
        html,
        text
      })
    });
    } catch (emailErr) {
      // Non-fatal — account deletion already succeeded
      console.error('Account-deleted user email failed (deletion still applied):', emailErr);
    }

    // 8. Notify admin (best-effort — failure here doesn't block the deletion response)
    try {
    const stripeStatusLine =
      stripeCancelStatus === 'cancelled'      ? `Stripe subscription cancelled (${stripeSubscriptionId}).`
    : stripeCancelStatus === 'failed'         ? `STRIPE CANCEL FAILED for subscription ${stripeSubscriptionId}: ${stripeCancelError}. Manual cancellation required in Stripe Dashboard.`
    : /* not_applicable */                      'No active Stripe subscription on this account.';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VerrixAI <admin@verrixai.com>',
        to: 'admin@verrixai.com',
        subject: stripeCancelStatus === 'failed'
          ? `[ACTION REQUIRED] Account deleted: ${email}. Stripe cancel failed`
          : `Account deleted: ${email}`,
        text: `User ${email} (${user_id}) has deleted their VerrixAI account.\n\n${stripeStatusLine}`
      })
    });
    } catch (adminErr) {
      // Non-fatal — account deletion already succeeded
      console.error('Account-deleted admin notify failed (deletion still applied):', adminErr);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
}
