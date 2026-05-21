# Consolidate Contract Signing + PDF, Reuse OTP

You're right on both counts. We over-built. Here's the cleanup.

## Why we have duplicates today

1. **Two edge functions** (`contract-signing` + `generate-stamped-pdf`) — they were authored in separate turns. They share the same domain (one contract → one signed PDF) and the same employer-profile + storage code. No reason to keep them split.
2. **Two OTP systems** — last turn I added a new `contract_sign_otps` table and a new `contract_sign_otp` template event. But `register-member` already uses a generic `otp_verifications` table + the Meta-approved `otp_verification` template (`{{code}}` variable). One more Meta template = one more approval cycle for no functional gain.

## Plan

### A. Merge edge functions → single `contract-signing` fn with action router

```
POST /contract-signing
  { action: 'request_otp',   token, channel }
  { action: 'verify_and_sign', token, otp, signature_png, witness, consent }
  { action: 'get_pdf',        contract_id, copy: 'employee'|'employer' }
  { action: 'regenerate_pdf', contract_id }   // owner/HR only, JWT required
```

- Move the entire pdf-lib stamping logic from `generate-stamped-pdf/index.ts` into a local `buildStampedPdf()` helper inside `contract-signing/index.ts`.
- Keep `verify_jwt = false` for `request_otp` and `verify_and_sign` (token-gated public flow); enforce JWT inside the handler for `get_pdf`/`regenerate_pdf`.
- Delete `supabase/functions/generate-stamped-pdf/` and call `supabase--delete_edge_functions(['generate-stamped-pdf'])`.
- Update the one caller (`HRM.tsx` "Stamped PDF" button) to invoke `contract-signing` with `action: 'get_pdf'`.

### B. Reuse existing OTP — drop the new table + template

- **Drop** `contract_sign_otps` table (migration) — it has zero rows.
- **Drop** the `contract_sign_otp` event from `src/lib/templates/systemEvents.ts`.
- In `contract-signing` use the existing `otp_verifications` table exactly the way `register-member` does (same row shape: phone, code, expires_at, attempts, consumed_at), with a `purpose='contract_sign'` discriminator column if it doesn't already exist (1-line ALTER if needed) — otherwise scope by `phone + recent + unconsumed`.
- Dispatch OTP via canonical hub with `event: 'otp_verification'`, variables `{ code }` — **same Meta template** already approved and live in production. No new Meta submission.
- Keep the new `contract_signed_confirmation` event (it's a different message: "your contract is signed, here's the PDF") — that one is genuinely new and worth its own template.

### C. Net file changes

Deleted:
- `supabase/functions/generate-stamped-pdf/index.ts`
- `contract_sign_otps` table (migration drop)
- `contract_sign_otp` from `systemEvents.ts`

Edited:
- `supabase/functions/contract-signing/index.ts` — add `get_pdf`/`regenerate_pdf` actions, swap OTP table to `otp_verifications`, swap template event to `otp_verification`
- `supabase/config.toml` — remove `[functions.generate-stamped-pdf]`
- `src/pages/HRM.tsx` — change invoke target + body
- `src/pages/ContractSign.tsx` — no UI change, just the underlying action name stays the same
- `mem://features/hrm-contracts-v2-evidentiary-signing` — note single-fn + shared OTP

### Benefits

- One fewer edge function to deploy, monitor, and CORS-configure.
- One fewer Meta WhatsApp template to maintain (and approve).
- One OTP table = one purge cron, one rate-limit surface, one place to audit OTP fraud.
- PDF generation can share the employer-profile fetch and storage signing helpers with the sign flow (no duplication).

## Questions before I execute

1. **OTP purpose discriminator** — `otp_verifications` today is keyed by phone only. For contract sign we also need to bind the OTP to a specific `contract_id` so an OTP issued for onboarding can't be used to sign a contract (and vice-versa). OK to add a nullable `purpose text` + `context_id uuid` column to `otp_verifications`? (Backward compatible — register-member keeps working with NULLs.)
2. **Email OTP** — `otp_verification` event today is `channels: ['whatsapp','sms']`. Contract sign also needs email fallback. OK to extend the existing event to include `email` (uses the same `{{code}}` variable, no Meta involvement for email)?
