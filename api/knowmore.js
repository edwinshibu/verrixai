const ALLOWED_ORIGIN = 'https://verrixai.com';
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT  = 5;          // max submissions
const RATE_WINDOW = 60 * 1000;  // per 60 seconds

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

function sanitise(str, maxLen = 100) {
  return String(str).replace(/[<>'"&]/g, '').trim().slice(0, maxLen);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }

  const { business_name, email } = req.body || {};

  // Validate required fields
  if (!business_name || !email) {
    return res.status(400).json({ error: 'Business name and email are required.' });
  }

  // Validate email format
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Sanitise inputs before using in email HTML
  const safeName  = sanitise(business_name, 100);
  const safeEmail = sanitise(email, 254);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_KEY) {
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // Save to Supabase waitlist
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ business_name: safeName, email: safeEmail })
  });

  if (!dbRes.ok && dbRes.status !== 409) {
    return res.status(500).json({ error: 'Failed to save your details. Please try again.' });
  }
  // If 409 (already registered), continue anyway and resend the email

  const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0F1E16;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1E16;padding:36px 20px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <tr><td align="center" style="padding-bottom:10px;">
          <span style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:#FFFFFF;letter-spacing:-0.5px;">Verrix<span style="color:#B8963E;">AI</span></span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:36px;">
          <span style="font-size:11px;color:#5A7A64;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;">Legal Intelligence for Modern Business</span>
        </td></tr>

        <tr><td style="background:#1A3A2A;border-radius:16px 16px 0 0;padding:48px 48px 40px;text-align:center;">
          <p style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#B8963E;margin:0 0 16px;">For ${safeName}</p>
          <p style="font-family:Georgia,serif;font-size:30px;font-weight:500;color:#FFFFFF;margin:0 0 20px;line-height:1.25;letter-spacing:-0.3px;">Most businesses sign agreements<br/>they have never truly read.</p>
          <p style="font-size:15px;color:rgba(255,255,255,0.65);margin:0;line-height:1.75;font-weight:300;">Buried in every contract, terms and conditions, or supplier agreement are clauses that can cost your business — financially, legally, and operationally. Most of the time, nobody catches them until it is too late.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#B8963E;padding:0 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr>
          <td style="padding:20px 16px;text-align:center;border-right:1px solid rgba(255,255,255,0.25);">
            <p style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#FFFFFF;margin:0;">91%</p>
            <p style="font-size:11px;color:rgba(255,255,255,0.85);margin:4px 0 0;line-height:1.4;">of people never fully read what they sign</p>
          </td>
          <td style="padding:20px 16px;text-align:center;border-right:1px solid rgba(255,255,255,0.25);">
            <p style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#FFFFFF;margin:0;">$billions</p>
            <p style="font-size:11px;color:rgba(255,255,255,0.85);margin:4px 0 0;line-height:1.4;">lost annually to unfavourable contract terms</p>
          </td>
          <td style="padding:20px 16px;text-align:center;">
            <p style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#FFFFFF;margin:0;">&lt;30s</p>
            <p style="font-size:11px;color:rgba(255,255,255,0.85);margin:4px 0 0;line-height:1.4;">to get a full analysis with VerrixAI</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:0 20px 48px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td style="background:#FFFFFF;border-radius:0 0 16px 16px;border:1px solid #E2E0D8;border-top:none;padding:40px 48px;">

          <p style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:#1A1A18;margin:0 0 10px;">What VerrixAI does for your business</p>
          <p style="font-size:14px;color:#6B6B62;margin:0 0 28px;line-height:1.75;">VerrixAI analyses any legal document — contracts, NDAs, supplier agreements, employment terms, software licences — and delivers a clear, structured breakdown in seconds. No legal training required. No waiting for a solicitor. Just instant clarity on what you are agreeing to.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="padding:14px 18px;background:#F7F6F2;border-left:3px solid #B8963E;border-radius:0 8px 8px 0;">
              <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 4px;">📋 Plain-English Summary</p>
              <p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">Every document distilled into a concise, jargon-free overview your whole team can understand before anyone signs.</p>
            </td></tr>
            <tr><td style="height:10px;"></td></tr>
            <tr><td style="padding:14px 18px;background:#F7F6F2;border-left:3px solid #C0392B;border-radius:0 8px 8px 0;">
              <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 4px;">⚠️ Risk Flag Analysis</p>
              <p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">High, medium, and low risk clauses identified and explained. Know exactly where the dangers are — auto-renewal traps, liability caps, termination penalties — before they catch you off guard.</p>
            </td></tr>
            <tr><td style="height:10px;"></td></tr>
            <tr><td style="padding:14px 18px;background:#F7F6F2;border-left:3px solid #1A3A2A;border-radius:0 8px 8px 0;">
              <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 4px;">🔑 Key Obligations Extracted</p>
              <p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">The clauses that create obligations for your business — payment terms, notice periods, exclusivity, IP ownership — surfaced and clearly explained.</p>
            </td></tr>
            <tr><td style="height:10px;"></td></tr>
            <tr><td style="padding:14px 18px;background:#F7F6F2;border-left:3px solid #2E5C42;border-radius:0 8px 8px 0;">
              <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 4px;">✨ Plain-Language Rewrite</p>
              <p style="font-size:13px;color:#6B6B62;margin:0;line-height:1.6;">The full document rewritten in plain, direct English. Share it with your team so everyone understands what the agreement actually means for your business.</p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="border-top:1px solid #E2E0D8;"></td></tr></table>

          <p style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:#1A1A18;margin:0 0 10px;">Why businesses trust VerrixAI</p>
          <p style="font-size:14px;color:#6B6B62;margin:0 0 20px;line-height:1.75;">We built VerrixAI specifically for the reality of modern business — where contracts arrive faster than your legal team can review them, and where a single overlooked clause can change everything.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr>
              <td width="28" style="vertical-align:top;padding-top:2px;"><div style="width:20px;height:20px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#1A3A2A;">✓</div></td>
              <td style="padding-bottom:14px;">
                <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 3px;">Powered by enterprise-grade AI</p>
                <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">Built on Claude by Anthropic — the same AI trusted by leading companies globally for complex document analysis.</p>
              </td>
            </tr>
            <tr>
              <td width="28" style="vertical-align:top;padding-top:2px;"><div style="width:20px;height:20px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#1A3A2A;">✓</div></td>
              <td style="padding-bottom:14px;">
                <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 3px;">Your documents are never stored</p>
                <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">Every document is processed in real time and deleted immediately after analysis. Nothing is saved to any server. Your sensitive business information stays yours.</p>
              </td>
            </tr>
            <tr>
              <td width="28" style="vertical-align:top;padding-top:2px;"><div style="width:20px;height:20px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#1A3A2A;">✓</div></td>
              <td style="padding-bottom:14px;">
                <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 3px;">Designed for non-lawyers</p>
                <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">You should not need a law degree to understand what your business is agreeing to. VerrixAI translates complex legal language into clear, actionable intelligence.</p>
              </td>
            </tr>
            <tr>
              <td width="28" style="vertical-align:top;padding-top:2px;"><div style="width:20px;height:20px;background:#EAF2EC;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#1A3A2A;">✓</div></td>
              <td>
                <p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0 0 3px;">Complement your existing legal team</p>
                <p style="font-size:12px;color:#6B6B62;margin:0;line-height:1.6;">VerrixAI does not replace your solicitor — it makes every conversation with them more productive. Arrive informed, ask better questions, and make faster decisions.</p>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="border-top:1px solid #E2E0D8;"></td></tr></table>

          <p style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:#1A1A18;margin:0 0 16px;">Simple, transparent pricing</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;border-radius:12px;overflow:hidden;border:1px solid #E2E0D8;">
            <tr style="background:#EAF2EC;">
              <td style="padding:12px 16px;border-bottom:1px solid #E2E0D8;"><p style="font-size:13px;font-weight:700;color:#1A3A2A;margin:0;">Free</p><p style="font-size:12px;color:#2E5C42;margin:2px 0 0;">10 scans — no credit card required</p></td>
              <td style="padding:12px 16px;border-bottom:1px solid #E2E0D8;text-align:right;"><p style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#1A3A2A;margin:0;">$0</p></td>
            </tr>
            <tr>
              <td style="padding:12px 16px;border-bottom:1px solid #E2E0D8;"><p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0;">Pro</p><p style="font-size:12px;color:#6B6B62;margin:2px 0 0;">300 scans/month · save 20% annually</p></td>
              <td style="padding:12px 16px;border-bottom:1px solid #E2E0D8;text-align:right;"><p style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#1A1A18;margin:0;">$9<span style="font-size:12px;font-weight:400;color:#6B6B62;">/mo</span></p></td>
            </tr>
            <tr>
              <td style="padding:12px 16px;border-bottom:1px solid #E2E0D8;"><p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0;">Pro 2</p><p style="font-size:12px;color:#6B6B62;margin:2px 0 0;">700 scans/month · save 20% annually</p></td>
              <td style="padding:12px 16px;border-bottom:1px solid #E2E0D8;text-align:right;"><p style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#1A1A18;margin:0;">$15<span style="font-size:12px;font-weight:400;color:#6B6B62;">/mo</span></p></td>
            </tr>
            <tr>
              <td style="padding:12px 16px;"><p style="font-size:13px;font-weight:700;color:#1A1A18;margin:0;">Enterprise</p><p style="font-size:12px;color:#6B6B62;margin:2px 0 0;">Unlimited scans · custom integrations</p></td>
              <td style="padding:12px 16px;text-align:right;"><p style="font-family:Georgia,serif;font-size:14px;font-weight:600;color:#B8963E;margin:0;">Contact us</p></td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center">
              <a href="https://verrixai.com" style="display:inline-block;background:#1A3A2A;color:#FFFFFF;font-family:Georgia,serif;font-size:16px;font-weight:500;text-decoration:none;padding:18px 48px;border-radius:12px;letter-spacing:0.02em;">
                Try VerrixAI free — no card required →
              </a>
            </td></tr>
          </table>

          <p style="font-size:11px;color:#B8B8AA;text-align:center;margin:0;line-height:1.6;">VerrixAI is a document intelligence tool and does not constitute legal advice.<br/>Always consult a qualified solicitor for binding legal decisions.</p>

        </td></tr>

        <tr><td style="padding:28px 0 12px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <span style="font-size:11px;color:#6B6B62;">🔒 Never stored or shared</span>
              <span style="font-size:11px;color:#CCCCCC;margin:0 10px;">|</span>
              <span style="font-size:11px;color:#6B6B62;">🛡️ Encrypted in transit</span>
              <span style="font-size:11px;color:#CCCCCC;margin:0 10px;">|</span>
              <span style="font-size:11px;color:#6B6B62;">⚖️ Not legal advice</span>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding-bottom:40px;">
          <p style="font-size:11px;color:#B8B8AA;margin:0;line-height:1.7;">
            You received this because you requested more information at <a href="https://verrixai.com" style="color:#B8963E;text-decoration:none;">verrixai.com</a>.<br/>
            &copy; VerrixAI. All rights reserved.
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
      from:    'VerrixAI <info@verrixai.com>',
      reply_to: 'noreply@verrixai.com',
      to:      safeEmail,
      subject: `Here is everything about VerrixAI, ${safeName}`,
      html:    emailHtml
    })
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Saved your details but failed to send email. Please try again.' });
  }

  return res.status(200).json({ success: true });
};
