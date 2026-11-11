# Security hardening: browser protection + login abuse limits

Goal: close the two real gaps from the audit without breaking sign-in, payments, chat, maps, push or the gate/scanner flows.

## What I confirmed
- The site sends no Content Security Policy today (none in the page head, no headers file).
- `resolve-login-identifier` and `request-password-reset` have no attempt limits. A shared limiter (`hit_public_form_rate_limit`) already exists and is used by lead capture; registration OTP has its own 10-minute limit.
- The page loads Razorpay checkout, the backend, Google storage (3D/scan media), self-hosted fonts and the push service worker.

## Phase 1 — Report-only browser policy (no breakage possible)
- Add a Content Security Policy in **report-only** mode listing every origin the app legitimately uses: own site, backend (data + realtime websockets + storage + functions), Razorpay, Google storage, YouTube/Instagram/Google Maps embeds if used, Lovable preview tooling, blob:/data: for images, PDFs, signatures and camera capture.
- Violations are logged (browser console + a lightweight report to System Health) for about a week, so we see anything the list missed. Nothing is blocked yet.

## Phase 2 — Enforce the policy
- After the report period is clean, switch to enforcing: block inline/unknown scripts, `unsafe-eval`, object embeds, framing by other sites (`frame-ancestors 'self'` + preview origin), and lock `connect-src` to the listed origins.
- Keep a single switch to fall back to report-only instantly if a page breaks.

## Phase 3 — Login and password-reset attempt limits
- `resolve-login-identifier`: limit by IP (20/min) and by phone (5/min). Over the limit returns the same generic "Too many attempts, try again shortly" with a retry time — no hint whether the number exists.
- `request-password-reset`: limit by email (3 per 10 min) and IP (10 per 10 min); keeps the existing generic success reply so accounts can't be discovered.
- Reuse the existing limiter; no new tables. Failures of the limiter itself fail open for login (so members are never locked out by an outage) but are logged to System Health.
- Sign-in page shows a clear, accessible message and countdown when limited.

## Not changing
Database rules, role checks, payments, OTP for contracts/registration, gate and scanner webhooks, member/team apps.

## Checks
- Playwright pass in report-only mode across home, sign-in, member dashboard, POS/Razorpay checkout, contract signing, scan login, chat widget; confirm zero unexpected violations before enforcing.
- Tests for both limits (6th phone attempt in a minute is refused; 4th reset email in 10 min is refused; generic reply unchanged).
- Real sign-in and password reset still work after deploy.

## Technical notes
- CSP delivered via `<meta http-equiv>` in `index.html` (`frame-ancestors` and reporting need headers; meta covers script/connect/img/frame-src — report-only will be done with a small `securitypolicyviolation` listener posting to `log_error_event`, since meta cannot be report-only).
- JSON-LD `<script type="application/ld+json">` blocks are data, not executed; allowed via hash if the browser flags them.
- Edge functions bump version comments and keep CORS/try-catch wrappers.
