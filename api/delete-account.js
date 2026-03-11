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
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VerrixAI <admin@verrixai.com>',
        to: email,
        subject: 'Your VerrixAI account has been deleted',
        html: `<div style="font-family:'Georgia',serif;max-width:540px;margin:0 auto;padding:40px 24px;color:#1A1A18;background:#F7F6F2;"><div style="font-size:22px;font-weight:600;margin-bottom:24px;">Verrix<span style="color:#B8963E;">AI</span></div><h2 style="font-size:22px;font-weight:500;margin-bottom:12px;">Account deleted</h2><p style="color:#6B6B62;font-size:15px;line-height:1.7;margin-bottom:16px;">Your VerrixAI account and all associated data have been permanently deleted as requested.</p><p style="color:#6B6B62;font-size:15px;line-height:1.7;margin-bottom:16px;">If you change your mind, you're always welcome to create a new account at <a href="https://verrixai.com" style="color:#2E5C42;">verrixai.com</a>.</p><p style="color:#6B6B62;font-size:14px;line-height:1.7;margin-top:32px;padding-top:20px;border-top:1px solid #E2E0D8;">If you didn't request this deletion, contact us at <a href="mailto:admin@verrixai.com" style="color:#2E5C42;">admin@verrixai.com</a>.</p></div>`,
        text: `Your VerrixAI account has been deleted.\n\nAll data has been permanently removed.\n\nIf you didn't request this, contact admin@verrixai.com immediately.`
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
