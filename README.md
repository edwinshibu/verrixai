<p align="center">
  <img src="favicon-180.png" alt="VerrixAI" width="120" />
</p>

# VerrixAI

AI-powered legal document analyzer. Upload a contract, lease, or NDA and get a plain-English breakdown with risk flags, key obligations, and a rewrite without the legalese.

**Live site:** [verrixai.com](https://verrixai.com)

---

## What I built

VerrixAI is a full-stack SaaS I built solo in one month while working full-time as a network admin. No prior experience building web products. I picked up everything on the go: frontend design, database architecture, payment integration, authentication, transactional email, security hardening, and deployment.

The product takes any legal document (PDF, DOCX, or TXT) and returns:

- A plain-English summary of what the document is
- Risk flags graded HIGH, MEDIUM, and LOW with one-line explanations
- The key obligations and clauses worth knowing
- A full rewrite of the document without the legalese

Document text is extracted in the browser using pdf.js and JSZip. The original file never reaches the server. Only the extracted text is sent to the API, capped at 60,000 characters.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML, CSS, JavaScript (no framework) |
| Hosting | Vercel (serverless functions, cron, preview deployments) |
| Database | Supabase (Postgres + Auth) |
| AI analysis | Anthropic Claude Sonnet via API |
| Payments | Stripe (subscriptions, webhooks) |
| Email | Resend (transactional) |
| DNS | Hostinger |

No frontend framework by design. For a solo build with a tight timeline, plain HTML meant faster iteration and simpler debugging.

---

## Architecture decisions worth noting

**Client-side document extraction.** pdf.js and JSZip run in the browser. Only the text reaches the server. This was a deliberate privacy decision and removes the need for file storage infrastructure entirely.

**Default-deny RLS on all Supabase tables.** Every table has a `USING (false)` deny policy first, then specific allow policies on top. No accidental data leakage from missing policies.

**Webhook idempotency.** Stripe retries webhooks on non-2xx responses. A `processed_webhook_events` table with `event_id` as primary key catches duplicates before they re-process. PostgREST returns 409 on PK conflict; the handler returns 200 immediately without re-running.

**Navigator.locks deadlock workaround.** Supabase JS 2.39+ has a known bug where async calls complete at the network level but the JS promise never resolves. Pinned to 2.38.4 and implemented a race-with-timeout pattern across all critical auth paths, with localStorage token fallback.

**Prompt injection boundary strip.** User document content is wrapped in `--- DOCUMENT START ---` / `--- DOCUMENT END ---` markers. Before wrapping, the markers are stripped from the raw content with a regex so a malicious document can't escape the boundary. Tested against 14 attack variants.

**Constant-time HMAC comparison.** Stripe webhook signature verification uses `crypto.timingSafeEqual` instead of `!==` to defend against timing side-channel attacks.

---

## What I learned

Going from network admin to shipping a full SaaS in one month meant picking up a lot fast. The biggest lessons:

- **Payments are harder than they look.** Stripe has a lot of edge cases: prorated upgrades, cancellation states, webhook retries, `current_period_end` moving between API versions. Most of the backend complexity lives here.
- **Auth bugs are invisible until they hurt.** The navigator.locks deadlock caused sessions to silently hang. HTTP showed 200; nothing resolved. Took several debugging sessions to understand.
- **Security requires a deliberate audit pass.** One pre-launch audit caught a critical bug: the delete-account endpoint wasn't cancelling the Stripe subscription. Paying users who deleted their account would have kept getting charged indefinitely.
- **Quota drift is real.** Every customer-facing surface that references a number (scan counts, plan limits) is a candidate for drift when that number changes. Took three sweep passes to catch all of them across HTML files, email templates, and JS fallback constants.
- **Ship before it's perfect.** The post-launch list is long. The pre-launch list got done because I drew a hard line between "launch blocker" and "nice to have."

---

## API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/analyse` | Run AI analysis on document text |
| `POST /api/create-checkout` | Create a Stripe Checkout session |
| `POST /api/change-plan` | Upgrade an existing subscription in-place |
| `POST /api/cancel-subscription` | Schedule a subscription cancellation |
| `POST /api/stripe-webhook` | Handle Stripe webhook events |
| `POST /api/delete-account` | Cancel subscription + delete user data |
| `POST /api/knowmore` | Send "want to know more" email to business leads |
| `GET /api/keepalive` | Daily cron ping to keep Supabase free tier active |

---

## Plans

| Plan | Price | Scans |
|---|---|---|
| Free | A$0 | 3 total |
| Starter | A$5/month | 50/month |
| Pro | A$9/month | 100/month |
| Pro 2 | A$15/month | 250/month |

Annual billing available at 20% discount.

---

## Full technical write-up

A detailed post covering the build journey, every bug caught, the security audit findings, and the unit economics:

[I built a SaaS in a month with Claude. Here is what actually happened.](https://dev.to/edwin_shibu_62f27da991422/i-built-a-saas-in-a-month-with-claude-here-is-what-actually-happened-41d3)

---

## Legal

This repository is public for transparency. It is not licensed for use, modification, or redistribution.

VerrixAI is an informational tool, not a substitute for legal advice. For binding decisions, consult a qualified solicitor.

© Edwin Shibu, trading as VerrixAI. All rights reserved.
