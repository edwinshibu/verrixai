module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { business_name, email } = req.body;
  if (!business_name || !email) {
    return res.status(400).json({ error: 'Business name and email are required.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;

  // ── Save to Supabase waitlist ──
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ business_name, email })
  });

  if (!dbRes.ok && dbRes.status !== 409) {
    const err = await dbRes.text();
    console.error('Supabase error:', err);
    return res.status(500).json({ error: 'Failed to save your details. Please try again.' });
  }

  if (dbRes.status === 409) {
    return res.status(409).json({ error: 'This email is already registered.' });
  }

  // ── Send branded email via Resend ──
  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

        <!-- LOGO -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1A1A18;letter-spacing:-0.3px;">
            Verrix<span style="color:#B8963E;">AI</span>
          </span>
        </td></tr>

        <!-- CARD -->
        <tr><td style="background:#FFFFFF;border-radius:18px;border:1px solid #E2E0D8;padding:40px 44px;box-shadow:0 4px 24px rgba(26,26,24,0.07);">

          <!-- ICON -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:24px;">
              <div style="width:56px;height:56px;background:#EAF2EC;border-radius:50%;display:inline-block;text-align:center;line-height:56px;font-size:24px;">⚖️</div>
            </td></tr>
          </table>

          <!-- HEADING -->
          <p style="font-family:Georgia,serif;font-size:24px;font-weight:500;color:#1A1A18;text-align:center;margin:0 0 10px;line-height:1.3;">
            Thanks for your interest, ${business_name}
          </p>

          <!-- SUBTEXT -->
          <p style="font-size:15px;color:#6B6B62;text-align:center;margin:0 0 28px;line-height:1.65;font-weight:300;">
            We're glad you reached out. Here's everything you need to know about how VerrixAI can help your business understand legal documents faster and smarter.
          </p>

          <!-- DIVIDER -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="border-top:1px solid #E2E0D8;"></td></tr>
          </table>

          <!-- WHAT WE DO -->
          <p style="font-family:Georgia,serif;font-size:17px;font-weight:500;color:#1A1A18;margin:0 0 12px;">What is VerrixAI?</p>
          <p style="font-size:14px;color:#6B6B62;margin:0 0 24px;line-height:1.7;">
            VerrixAI is an AI-powered legal document analyser. Upload or paste any contract, agreement, NDA, or terms & conditions — and get back a plain-English summary, risk flags, and the key clauses that matter. In seconds.
          </p>

          <!-- FEATURES -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="padding:10px 14px;background:#F7F6F2;border-radius:10px;margin-bottom:8px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="32" style="font-size:18px;vertical-align:top;padding-top:2px;">📋</td>
                    <td>
                      <p style="font-size:13px;font-weight:600;color:#1A1A18;margin:0 0 2px;">Plain-English Summaries</p>
                      <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.5;">Understand any document instantly — no legal background needed.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:10px 14px;background:#F7F6F2;border-radius:10px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="32" style="font-size:18px;vertical-align:top;padding-top:2px;">⚠️</td>
                    <td>
                      <p style="font-size:13px;font-weight:600;color:#1A1A18;margin:0 0 2px;">Risk Flagging</p>
                      <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.5;">High, medium, and low risk clauses identified and explained clearly.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:10px 14px;background:#F7F6F2;border-radius:10px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="32" style="font-size:18px;vertical-align:top;padding-top:2px;">🔑</td>
                    <td>
                      <p style="font-size:13px;font-weight:600;color:#1A1A18;margin:0 0 2px;">Key Points Extraction</p>
                      <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.5;">The most important obligations and terms surfaced automatically.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:10px 14px;background:#F7F6F2;border-radius:10px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="32" style="font-size:18px;vertical-align:top;padding-top:2px;">🔒</td>
                    <td>
                      <p style="font-size:13px;font-weight:600;color:#1A1A18;margin:0 0 2px;">Never Stored or Shared</p>
                      <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.5;">Your documents are processed and deleted immediately. Always private.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- PRICING TEASER -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#EAF2EC;border-radius:12px;padding:18px 20px;">
              <p style="font-family:Georgia,serif;font-size:15px;font-weight:500;color:#1A3A2A;margin:0 0 8px;">Simple, transparent pricing</p>
              <p style="font-size:12px;color:#2E5C42;margin:0;line-height:1.6;">
                ✦ <strong>Free</strong> — 10 scans with a free account<br/>
                ✦ <strong>Pro</strong> — 300 scans/month · $9/mo or $86/yr<br/>
                ✦ <strong>Pro 2</strong> — 700 scans/month · $15/mo or $144/yr<br/>
                ✦ <strong>Enterprise</strong> — Unlimited · Contact us
              </p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="https://verrixai.vercel.app"
                 style="display:inline-block;background:#1A3A2A;color:#FFFFFF;font-size:15px;font-weight:500;text-decoration:none;padding:15px 40px;border-radius:12px;letter-spacing:0.02em;">
                Try VerrixAI free →
              </a>
            </td></tr>
          </table>

          <!-- DIVIDER -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="border-top:1px solid #E2E0D8;padding-top:20px;">
              <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;text-align:center;">
                Questions? Reply to this email and we'll get back to you personally.
              </p>
            </td></tr>
          </table>

        </td></tr>

        <!-- TRUST ROW -->
        <tr><td style="padding:24px 0 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <span style="font-size:11px;color:#6B6B62;">🔒 Never stored or shared</span>
              <span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
              <span style="font-size:11px;color:#6B6B62;">🛡️ Encrypted in transit</span>
              <span style="font-size:11px;color:#E2E0D8;margin:0 10px;">|</span>
              <span style="font-size:11px;color:#6B6B62;">⚖️ Not legal advice</span>
            </td></tr>
          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td align="center" style="padding-top:16px;">
          <p style="font-size:11px;color:#B8B8AA;margin:0;line-height:1.6;">
            You received this because you requested more info at
            <a href="https://verrixai.vercel.app" style="color:#B8963E;text-decoration:none;">verrixai.vercel.app</a>.<br/>
            Not legal advice. Always consult a qualified solicitor for binding decisions.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`
    },
    body: JSON.stringify({
      from: 'VerrixAI <onboarding@resend.dev>',
      to: email,
      subject: `Here's everything about VerrixAI, ${business_name}`,
      html: emailHtml
    })
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Saved your details but failed to send email. Please try again.' });
  }

  return res.status(200).json({ success: true });
};
