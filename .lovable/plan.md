# Fix pack: plan templates, renewal invoices, daily report, reminder text, password reset

Verified against the live database and code. Six independent defects.

## 1. Plan Templates page queries a table that doesn't have those columns

`/fitness/templates` reads the messaging `templates` table (`type='document'`, `category=...`, `pdf_url`). That table has no `category` and no `pdf_url` columns — hence the 400 `column templates.category does not exist` and the permanent "No templates found." The real store is `fitness_plan_templates` (`type` = workout/diet, `pdf_url`, `pdf_filename`, `is_active`), which is exactly what the upload drawer writes to.

Fix: point the page at `fitness_plan_templates`, filter on `type` + `is_active`, and show name/description/goal/difficulty.

Also restore the page heading — it currently renders a pasted error URL instead of "Plan Templates".

## 2. Workout/diet PDFs return 400 when opened

The `attachments` bucket is private, but older rows saved a public-style object URL (`/storage/v1/object/attachments/...`), which the storage API rejects. Newer uploads store a 30-day signed URL, which will also break once it expires.

Fix: store the object **path** alongside the URL and always mint a fresh short-lived signed URL at click/view time (same pattern as `signMemberDocument`). Add a fallback that derives the path from any legacy stored URL so existing templates and member plans open again — no re-upload needed. Applies to Plan Templates, My Workout, My Diet and the plan-send flow.

## 3. `generate_renewal_invoices` crashes on every run

The function inserts into `invoices` without `subtotal`, and `invoices.subtotal` is NOT NULL. Every renewal invoice attempt aborts.

Fix: insert `subtotal` (and explicit `tax_amount`/`discount_amount`) alongside `total_amount`, and let the invoice-number trigger fire by passing `NULL`.

## 4. `daily_ops_summary` reported as failed (HTTP 424) when nothing is wrong

The function treats any delivery whose status isn't sent/delivered/queued as incomplete — including `deduped`, which just means the report was already sent for that recipient today. The whole run is then flagged failed.

Fix: treat `deduped`, `suppressed` (opt-out) and `skipped_quiet_hours` as acceptable outcomes; only return 424 when a delivery genuinely errored. Keep the warning log for real failures.

## 5. Payment reminders show `Dear {{1}}` and `₹{{2}}`

`send-reminders` looks up the approved WhatsApp template and passes its raw body as the email/SMS body, but only passes `template_id` for the WhatsApp channel — so nothing substitutes the positional placeholders on email/SMS.

Fix: use the WhatsApp template body only for WhatsApp. For email/SMS, resolve the channel's own template (or the plain fallback sentence), and substitute `{{n}}` / named variables locally before dispatch so no raw placeholder can ever reach a recipient. Add a guard in the dispatcher that rejects a freeform body still containing `{{`.

## 6. Password reset email

Two problems found:
- The fallback only fires when the built-in mailer returns an error. Supabase returns success even when the mail is silently dropped, so the fallback rarely runs.
- Unrelated but visible in the same area: signed-out pages call the `settings` table, whose policy runs `has_any_role`, and that function is no longer executable by anonymous visitors (401 `permission denied for function has_any_role` on every public page load).

Fix: always send the reset through our own mail engine (`request-password-reset` → dispatcher) and keep the built-in mailer as a secondary attempt, so a delivery record always lands in the email log and failures are visible. Then verify an end-to-end reset send and report the log row. For the anonymous 401, switch the DR-mode check on public pages to the existing public RPC so signed-out visitors stop hitting a policy they can't evaluate.

## Technical notes

- `src/pages/fitness/Templates.tsx` — query `fitness_plan_templates`; restore heading; open PDFs via signer.
- New `src/lib/documents/signAttachment.ts` — path-or-legacy-URL → fresh signed URL; used by Templates, `MyWorkout`, `MyDiet`, `PlanPdfViewer`.
- `src/components/fitness/UploadPdfTemplateDrawer.tsx` + `src/utils/uploadAttachment.ts` — persist `pdf_path`; migration adds `pdf_path text` to `fitness_plan_templates` and `member_fitness_plans`.
- Migration: `CREATE OR REPLACE FUNCTION public.generate_renewal_invoices()` with `subtotal`.
- `supabase/functions/daily-ops-summary/index.ts` → v1.2.0 (acceptable-status list); redeploy.
- `supabase/functions/send-reminders/index.ts` → channel-correct template resolution + local variable substitution; `dispatch-communication` freeform placeholder guard; redeploy both.
- `src/contexts/AuthContext.tsx` — reset order swap; `src/hooks/useDrMode.ts` — use `dr_is_operational` RPC for unauthenticated sessions.
