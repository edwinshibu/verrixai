const ALLOWED_ORIGIN = 'https://verrixai.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
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

    // 2. Delete profile row
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });

    // 3. Delete invites row
    await fetch(`${SUPABASE_URL}/rest/v1/invites?user_id=eq.${user_id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });

    // 4. Delete auth user
    const deleteUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    if (!deleteUserRes.ok) {
      const err = await deleteUserRes.json();
      throw new Error(err.message || 'Failed to delete auth user');
    }

    // 5. Send confirmation email to user
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
<p style="font-size:13px;color:#6B6B62;margin:0 0 24px;line-height:1.7;">Documents you analysed were never stored on our servers in the first place — they're processed in real time and discarded after each scan. Nothing additional to remove there.</p>
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
    const text = `Your VerrixAI account has been deleted.\n\nWhat was deleted:\n  - Your account credentials and login\n  - Your profile (plan, scan history, settings)\n  - Any associated records in our database\n\nDocuments you analysed were never stored on our servers — they're processed in real time and discarded after each scan.\n\nIf you change your mind, you're always welcome to create a new account at https://verrixai.com.\n\nDidn't request this? Contact admin@verrixai.com immediately. While the data itself can't be recovered, we want to know if your account was compromised.\n\nThis is the last email you'll receive from us.`;
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

    // 6. Notify admin
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VerrixAI <admin@verrixai.com>',
        to: 'admin@verrixai.com',
        subject: `Account deleted: ${email}`,
        text: `User ${email} (${user_id}) has deleted their VerrixAI account.`
      })
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
}
