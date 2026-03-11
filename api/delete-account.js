import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const ALLOWED_ORIGIN = 'https://verrixai.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, email } = req.body || {};
  if (!user_id || !email) return res.status(400).json({ error: 'Missing user_id or email' });

  // Verify the request is from an authenticated user matching the user_id
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const token = authHeader.split(' ')[1];

  try {
    // Verify token matches the user
    const sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await sbAnon.auth.getUser(token);
    if (authError || !user || user.id !== user_id) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    // Use service role to delete user data and auth record
    const sbAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 1 — Delete profile row
    await sbAdmin.from('profiles').delete().eq('id', user_id);

    // 2 — Delete invites row if exists
    await sbAdmin.from('invites').delete().eq('user_id', user_id);

    // 3 — Delete auth user
    const { error: deleteError } = await sbAdmin.auth.admin.deleteUser(user_id);
    if (deleteError) throw deleteError;

    // 4 — Send confirmation email to user
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'VerrixAI <admin@verrixai.com>',
      to: email,
      subject: 'Your VerrixAI account has been deleted',
      html: `
        <div style="font-family:'Georgia',serif;max-width:540px;margin:0 auto;padding:40px 24px;color:#1A1A18;background:#F7F6F2;">
          <div style="font-family:'Georgia',serif;font-size:22px;font-weight:600;margin-bottom:24px;">
            Verrix<span style="color:#B8963E;">AI</span>
          </div>
          <h2 style="font-size:22px;font-weight:500;margin-bottom:12px;">Account deleted</h2>
          <p style="color:#6B6B62;font-size:15px;line-height:1.7;margin-bottom:16px;">
            Your VerrixAI account and all associated data have been permanently deleted as requested.
          </p>
          <p style="color:#6B6B62;font-size:15px;line-height:1.7;margin-bottom:16px;">
            If you change your mind, you're always welcome to create a new account at
            <a href="https://verrixai.com" style="color:#2E5C42;">verrixai.com</a>.
          </p>
          <p style="color:#6B6B62;font-size:14px;line-height:1.7;margin-top:32px;padding-top:20px;border-top:1px solid #E2E0D8;">
            If you didn't request this deletion, please contact us immediately at
            <a href="mailto:admin@verrixai.com" style="color:#2E5C42;">admin@verrixai.com</a>.
          </p>
        </div>
      `,
      text: `Your VerrixAI account has been deleted.\n\nAll your data has been permanently removed. If you change your mind, you can create a new account at verrixai.com.\n\nIf you didn't request this, contact admin@verrixai.com immediately.`
    });

    // 5 — Notify admin
    await resend.emails.send({
      from: 'VerrixAI <admin@verrixai.com>',
      to: 'admin@verrixai.com',
      subject: `Account deleted: ${email}`,
      text: `User ${email} (${user_id}) has deleted their account.`
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
}
