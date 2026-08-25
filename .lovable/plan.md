# Audit: PT activation, MIPS gating, email limits

## What I verified in the live data

- **Sahiba (INC-26-0100)**: invoice `BOS-INC-26-0039` is **paid** (₹8,000 cash, 24/08 22:03), but her PT package row is still `pending_payment` with `sessions_total = 0`, trainer Bhagirath, expiry 19/09/2026. So the UI is right — the data never activated.
  Cause: activation only fires from a trigger on `payments` that re-reads `invoices.amount_paid`. When the payment row lands before the invoice totals are updated, the check `amount_paid >= total_amount` fails and the package is left pending forever. There is **no** activation trigger on `invoices` to catch it afterwards.
- **Shubham Rajawat (INC-26-0130)**: created 24/08, **no membership**, yet `mips_sync_status = synced`, MIPS person id 247. The `sync-to-mips` function deliberately grants a **24-hour "probation window"** when a member has no membership — that is exactly the 25/08 00:45 → 26/08 00:45 validity in the MIPS screenshot. Sync is triggered automatically by the biometric-photo trigger, independent of any membership.
- **Email**: sending goes through your own Hostinger SMTP (`smtp.hostinger.com:587`, `info@theinclinelife.com`) — no Lovable/Cloud email domain is live yet. 462 email rows are stuck in `sending` and never reach a terminal status, so failures are invisible and retries never happen. The "only 12 go out" symptom is consistent with the Hostinger hourly cap, but the exact SMTP refusal text is not recorded anywhere — step 3 starts by capturing it.

## 1. PT activation and PT purchase workflow

- Add an activation trigger on `invoices` (after update of `status`/`amount_paid`) that activates any `pending_payment` PT package linked to that invoice — same rule as the payment trigger, so whichever event lands last wins. Idempotent via `activate_pt_package`.
- Backfill: activate Sahiba's package (and any other package whose invoice is fully paid), confirm the trainer commission flips from `earned_unconfirmed` to `earned`, and set the trainer as her assigned trainer.
- Fix `sessions_total = 0`: monthly coaching packages should store the plan's session count (or be explicitly marked "unlimited/monthly") so the profile doesn't show "0 PT Sessions".
- A reconciliation check (existing findings engine) flags any PT package left `pending_payment` while its invoice is paid, so this never sits silently again.

## 2. Member profile UI — Personal Training strip

Currently the strip shows the package but the primary action still reads "Complete PT Payment" from stale state. After activation it will read:

- Status badge: `Active` (emerald) / `Awaiting payment` (amber) / `Expired` (red).
- Line 1: package name. Line 2: **trainer name · sessions remaining/total · expires 19 Sep 2026**.
- Primary action becomes **Manage PT**; "Buy PT" only appears when there is genuinely no live package.
- The PT Sessions KPI tile reads from the active package instead of showing 0.

## 3. MIPS — one gate, no bypass

- **Remove the 24-hour probation window.** A member with no active/valid membership is never pushed with a future validity.
- Single entry point: every path (photo trigger, biometric queue, payment webhook, reconcile, face sweep, manual sync) resolves access through one server-side function — `evaluate_member_access_state` / `member_access_status` — and `sync-to-mips` refuses to write a person record with a future `validTimeEnd` unless that gate returns allowed.
- No membership → either don't create the MIPS person at all, or create it with the canonical revoked date `2000-01-01`. Enrolment (face/photo) stays possible; access does not.
- Remediate Shubham now: push revoked validity to MIPS and dispatch to devices; then sweep all members without an active membership that currently hold a future validity.
- Turnstile pass-through for a member with no plan is treated as a monitored finding, not a silent event.

## 4. Email — remove the 12-per-hour ceiling

- Stop the silent hole first: `send-email` must write back `sent` / `failed` with the SMTP response, so the stuck `sending` rows terminalize and the real Hostinger refusal is captured.
- Add a paced sender for bulk email (chunked, with per-hour budget) plus retry on transient 4xx, matching what WhatsApp already does.
- Add a provider fallback chain: primary provider → secondary. To lift the cap properly, the recommended primary is the Cloud email infrastructure on your own sender domain (`notify.theincline.in`), with Hostinger SMTP kept as the fallback. That domain still needs its DNS records added at your registrar before it can send — I'll confirm status and give you the exact records.
- Surface per-provider hourly usage and last error in System Health so a cap is visible before a campaign stalls.

## Technical notes

- New migration: `tg_invoice_activate_pt_package` on `public.invoices`; backfill UPDATE via data query; no schema change to `member_pt_packages`.
- `supabase/functions/sync-to-mips/index.ts`: delete the probation branch (~lines 855-858), add the access-gate check before any person write, keep `2000-01-01` as the canonical revoked date.
- `supabase/functions/send-email/index.ts` + `dispatch-communication`: terminal status write-back, provider chain, pacing.
- UI: `MemberProfileDrawer.tsx` PT strip and KPI tile; `PurchasePTPackageDrawer.tsx` duplicate guard stays as-is.
- Memory updates: MIPS "no membership = no access, no probation" rule; PT activation dual-trigger rule; email provider chain.
