const ALLOWED_ORIGIN = 'https://verrixai.com';

// List of recipients — add names and emails here before triggering
const RECIPIENTS = [
   { name: 'Edwin Shibu',  email: 'edwinshibu255@gmail.com' },
  // { name: 'John Doe',    email: 'john@example.com' },
];

const EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>VerrixAI — Understand Every Agreement</title>
</head>
<body style="margin:0;padding:0;background:#F7F6F2;font-family:'Georgia',serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:40px 20px;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER / LOGO -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:'Georgia',serif;font-size:26px;font-weight:700;color:#1A1A18;letter-spacing:-0.5px;">
                  Verrix<span style="color:#B8963E;">AI</span>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top:8px;">
                  <span style="display:inline-block;background:#EAF2EC;color:#2E5C42;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:5px 14px;border-radius:999px;">
                    ✦ Now Live
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- HERO CARD -->
        <tr>
          <td>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1A3A2A;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:52px 48px 44px;">
                  <p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#B8963E;">AI-Powered Document Intelligence</p>
                  <h1 style="margin:0 0 20px;font-family:'Georgia',serif;font-size:36px;font-weight:400;line-height:1.2;color:#FFFFFF;letter-spacing:-0.5px;">
                    Understand every<br/>agreement before<br/>you <em style="color:#B8963E;font-style:italic;">sign</em>
                  </h1>
                  <p style="margin:0 0 36px;font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:rgba(255,255,255,0.72);font-weight:300;">
                    We've built something we think you'll find genuinely useful. VerrixAI analyses any legal document — contracts, terms &amp; conditions, privacy policies — and gives you a clear, structured breakdown in seconds.
                  </p>
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background:#B8963E;border-radius:10px;">
                        <a href="https://verrixai.com?source=invite" style="display:inline-block;padding:15px 36px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">
                          Try it free →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SPACER -->
        <tr><td style="height:32px;"></td></tr>

        <!-- THE PROBLEM -->
        <tr>
          <td style="background:#FFFFFF;border-radius:16px;padding:40px 40px 36px;border:1px solid #E2E0D8;">
            <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#B8963E;">The problem</p>
            <h2 style="margin:0 0 16px;font-family:'Georgia',serif;font-size:24px;font-weight:400;color:#1A1A18;line-height:1.3;">
              Legal documents are designed to be unreadable
            </h2>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#6B6B62;">
              Dense paragraphs. Legal jargon. Pages of fine print. Most people sign contracts without truly understanding what they're agreeing to — not because they're careless, but because the language is deliberately complex. That changes now.
            </p>
          </td>
        </tr>

        <!-- SPACER -->
        <tr><td style="height:20px;"></td></tr>

        <!-- BENEFITS -->
        <tr>
          <td>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom:12px;">
                  <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6B6B62;text-align:center;">What VerrixAI does for you</p>
                </td>
              </tr>
              <tr>
                <td width="48%" valign="top" style="background:#FFFFFF;border-radius:14px;padding:28px 26px;border:1px solid #E2E0D8;">
                  <div style="font-size:28px;margin-bottom:14px;">⚠️</div>
                  <p style="margin:0 0 8px;font-family:'Georgia',serif;font-size:17px;font-weight:400;color:#1A1A18;">Risk Flags</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#6B6B62;">Instantly surfaces HIGH, MEDIUM and LOW risk clauses — the things that could actually hurt you, highlighted before you sign.</p>
                </td>
                <td width="4%"></td>
                <td width="48%" valign="top" style="background:#FFFFFF;border-radius:14px;padding:28px 26px;border:1px solid #E2E0D8;">
                  <div style="font-size:28px;margin-bottom:14px;">📋</div>
                  <p style="margin:0 0 8px;font-family:'Georgia',serif;font-size:17px;font-weight:400;color:#1A1A18;">Plain Summary</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#6B6B62;">A concise, jargon-free overview of what the document actually says — in language a normal person can understand.</p>
                </td>
              </tr>
              <tr><td colspan="3" style="height:12px;"></td></tr>
              <tr>
                <td width="48%" valign="top" style="background:#FFFFFF;border-radius:14px;padding:28px 26px;border:1px solid #E2E0D8;">
                  <div style="font-size:28px;margin-bottom:14px;">🔑</div>
                  <p style="margin:0 0 8px;font-family:'Georgia',serif;font-size:17px;font-weight:400;color:#1A1A18;">Key Points</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#6B6B62;">The most important clauses, obligations, and terms — extracted and listed so nothing critical gets buried in the text.</p>
                </td>
                <td width="4%"></td>
                <td width="48%" valign="top" style="background:#1A3A2A;border-radius:14px;padding:28px 26px;">
                  <div style="font-size:28px;margin-bottom:14px;">✨</div>
                  <p style="margin:0 0 8px;font-family:'Georgia',serif;font-size:17px;font-weight:400;color:#FFFFFF;">Simplified Version</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.68);">The full document rewritten in plain English — so you can actually read it like a human being, not a lawyer.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SPACER -->
        <tr><td style="height:20px;"></td></tr>

        <!-- HOW IT WORKS -->
        <tr>
          <td style="background:#FFFFFF;border-radius:16px;padding:40px 40px 36px;border:1px solid #E2E0D8;">
            <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#B8963E;">How it works</p>
            <h2 style="margin:0 0 28px;font-family:'Georgia',serif;font-size:22px;font-weight:400;color:#1A1A18;">Three steps. Under 30 seconds.</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td width="40" valign="top">
                  <div style="width:32px;height:32px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:32px;font-family:'Georgia',serif;font-size:15px;color:#1A3A2A;font-weight:700;">1</div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1A1A18;">Upload or paste your document</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#6B6B62;line-height:1.6;">PDF, DOCX, or paste raw text. Any contract, lease, privacy policy, or legal agreement.</p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td width="40" valign="top">
                  <div style="width:32px;height:32px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:32px;font-family:'Georgia',serif;font-size:15px;color:#1A3A2A;font-weight:700;">2</div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1A1A18;">Choose your analysis options</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#6B6B62;line-height:1.6;">Select what you want — summary, risk flags, key points, simplified version, or all four.</p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="40" valign="top">
                  <div style="width:32px;height:32px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:32px;font-family:'Georgia',serif;font-size:15px;color:#1A3A2A;font-weight:700;">3</div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1A1A18;">Get your clear breakdown</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#6B6B62;line-height:1.6;">Instant, structured results. Know exactly what you're agreeing to — before you put pen to paper.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SPACER -->
        <tr><td style="height:20px;"></td></tr>

        <!-- CTA BLOCK -->
        <tr>
          <td style="background:#1A3A2A;border-radius:16px;padding:44px 48px;text-align:center;">
            <p style="margin:0 0 10px;font-family:'Georgia',serif;font-size:26px;color:#FFFFFF;font-weight:400;line-height:1.3;">Ready to try it?</p>
            <p style="margin:0 0 28px;font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.65);line-height:1.6;">
              Free to use. No credit card. 5 scans on sign-up.<br/>Your documents are never stored or shared.
            </p>
            <table align="center" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#B8963E;border-radius:10px;">
                  <a href="https://verrixai.com?source=invite" style="display:inline-block;padding:16px 44px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.03em;">
                    Go to VerrixAI →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.4);">
              🔒 Encrypted in transit · Not legal advice
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:28px 0;text-align:center;">
            <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:12px;color:#9B9B8E;line-height:1.7;background:#F0EEE8;border-radius:8px;padding:12px 16px;">
              📬 If this landed in <strong>Promotions</strong>, drag it to <strong>Primary</strong> — it helps us reach you next time.
            </p>
            <p style="margin:0 0 6px;font-family:'Georgia',serif;font-size:15px;color:#1A1A18;">Verrix<span style="color:#B8963E;">AI</span></p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#9B9B8E;line-height:1.6;">
              Not legal advice. Always consult a qualified solicitor for binding decisions.<br/>
              &copy; 2026 VerrixAI. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Protect this endpoint with a secret key — only you can trigger it
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.INVITE_ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Resend API key not configured.' });

  if (!RECIPIENTS.length) {
    return res.status(400).json({ error: 'No recipients defined. Add them to the RECIPIENTS array.' });
  }

  const results = { sent: [], failed: [] };

  for (const recipient of RECIPIENTS) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_KEY}`
        },
        body: JSON.stringify({
          from:     'VerrixAI <info@verrixai.com>',
          reply_to: 'noreply@verrixai.com',
          to:       recipient.email,
          subject:  `We built something we think you'll actually use`,
          html:     EMAIL_HTML,
          text:     `Hey,\n\nWe built something we think you'll find genuinely useful — and we wanted you to be one of the first to try it.\n\nIt's called VerrixAI. Legal documents are deliberately hard to read — contracts, leases, privacy policies, terms & conditions. Most people sign them without truly understanding what they're agreeing to.\n\nVerrixAI fixes that. Upload or paste any legal document and within seconds you get:\n\n- A plain-English summary of what it actually says\n- Risk flags — clauses ranked HIGH / MEDIUM / LOW that could come back to bite you\n- Key points — the most important obligations extracted clearly\n- A fully simplified rewrite in language a normal person can understand\n\nIt works on PDFs, Word docs, or pasted text. Takes about 30 seconds. Your document is never stored.\n\nFree to use, no credit card needed, 5 scans on sign-up.\n\nhttps://verrixai.com?source=invite\n\nLet us know what you think — honest feedback very welcome.\n\nThe VerrixAI team\n\n---\nNot legal advice. Always consult a qualified solicitor for binding decisions.\n© 2026 VerrixAI. All rights reserved.`
        })
      });

      if (emailRes.ok) {
        results.sent.push(recipient.email);
      } else {
        const err = await emailRes.text();
        console.error(`Failed to send to ${recipient.email}:`, err);
        results.failed.push({ email: recipient.email, error: err });
      }

      // Small delay between sends to avoid rate limits
      await new Promise(r => setTimeout(r, 200));

    } catch (e) {
      console.error(`Error sending to ${recipient.email}:`, e.message);
      results.failed.push({ email: recipient.email, error: e.message });
    }
  }

  return res.status(200).json({
    success: true,
    sent:    results.sent.length,
    failed:  results.failed.length,
    details: results
  });
};
