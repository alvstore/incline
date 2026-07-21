
# Scope

Fix the concrete "Stop 0 messages" bug, tighten the member → purchase → invoice → payment → reminder RPC chain, close the remaining gaps in RCS and Email delivery, and add a real push-sync control to the RCS Template Manager. No behavior change outside these areas.

---

## 1. Retry Queue — real Stop, real Clear

Root cause of "Stopped 0 messages": `stopAll` in `RetryQueuePanel.tsx` filters out `status === 'exhausted'`, but the visible tab is **Exhausted 100**, so nothing matches.

Fix (frontend only):
- `stopAll` operates on the currently-filtered `visible` list without the `!== 'exhausted'` guard. Exhausted rows are already terminal, so we won't "cancel" them — instead we'll **delete/clear** them.
- Split the header buttons based on the active tab:
  - Pending/Retrying/Failed → **Stop all** (sets `status='cancelled'`).
  - Exhausted → **Clear exhausted** (deletes the rows; confirmation dialog).
  - All → both actions available.
- Per-row: add **Clear** on exhausted rows (delete) alongside the existing **Stop** on live rows.
- Empty toast (`Stopped 0`) is replaced with an "Nothing to stop" info toast when the target list is empty.

---

## 2. Member → Purchase → Invoice → Payment RPC audit

Read-only audit of `purchase_membership`, `record_payment`, `reverse_payment`, `settle_payment`, `cancel_membership`, `freeze_membership`, `transition_member_lifecycle`, plus the invoice/PDF and reminder side effects. Concrete fixes we already know are needed:

- **Login provisioning gap**: `provision-member-login` exists but is only wired to the manual convert path. Add a DB trigger on `members` (AFTER INSERT) that enqueues login provisioning for any member with an email, so self-registered and admin-created members both get an auth account without extra clicks.
- **Payment reminders**: `send-reminders` currently walks `invoices` directly; ensure it uses `reminder_configurations` (branch-scoped) and honors `do_not_contact` via the dispatcher. Add a dedupe key `payment-reminder:<invoice_id>:<stage>` so duplicate sends are suppressed.
- **Razorpay webhook**: verify `verify-payment` + `payment-webhook` both funnel through `settle_payment` (single source of truth). If either bypasses it, route it through.
- **Invoice PDF link on reminders**: `{{document_link}}` must resolve via `signMemberDocument` in the dispatcher (already the rule); confirm reminder template events (`payment_reminder_soft`, `payment_reminder_firm`, `payment_reminder_final`) all use `header_type='none'` per project convention.
- Any missing GRANTs or SECURITY DEFINER `search_path` on the RPCs above are patched in one migration.

Deliverable: one migration + a short audit note in chat listing what was already fine.

---

## 3. Complete RCS + Email delivery

RCS:
- Ensure `dispatch-communication` routes `channel:'rcs'` → `send-rcs` for **both** Telinfy and Smartping via the shared adapter (already true; verify).
- `rcs-webhook` writes DLR events for both providers into `communication_delivery_events` and updates `communication_logs.status` (delivered/read/failed). Add missing Smartping status codes if any.
- `reconcile-rcs-pending` cron confirms terminal state for logs stuck in `sent` > 15 min.
- Freeform → SMS fallback path stays intact (dispatcher already does it).

Email:
- Verify `process-email-queue` cron is present and healthy (call `email_domain--check_email_domain_status`); if the domain isn't configured yet, surface the setup dialog once.
- Confirm `send-email` handles attachments (`document_link`) and unsubscribe token injection.
- Add DLR-style event write from `email-webhook` (Resend/SES bounce/complaint/delivered) into `communication_delivery_events` mirroring the WhatsApp/RCS pattern.

No client API surface changes — everything flows through `dispatchCommunication()`.

---

## 4. RCS Template Manager — Push Sync

Today the hub has **Sync from <provider>** (pull). Add **Push to <provider>** on the Templates tab:

- New button next to Sync. Opens a small drawer listing local `rcs_templates` rows where `external_template_id IS NULL` (i.e., not yet on provider) with a per-row **Push** action and a **Push all** bulk action.
- New edge function `rcs-templates-push` (adapter-based, same shape as `rcs-templates-sync`):
  - Smartping: `POST /rcs/api/template/create` with template payload.
  - Telinfy: `POST /rcs/templates` (documented path).
  - On success, write back `external_template_id`, `provider`, `status='pending_approval'`.
- Guardrails: template must have `kind`, `body`, and at least one language; media assets must be a public https URL.
- Provider capability check: block push for kinds the provider doesn't support (e.g., rich cards on basic-only providers) with a clear inline reason.

---

## Out of scope (for this plan)

- Non-RCS/email provider swaps.
- Any UI change outside Retry Queue and RCS Template Manager.
- Re-designing the reminders configuration screen (only the sending path is touched).

---

## Technical notes

- Files touched (edits only, no rewrites):
  - `src/components/communications/RetryQueuePanel.tsx`
  - `src/components/settings/rcs/RcsHub.tsx` (+ small drawer component)
  - `supabase/functions/dispatch-communication/index.ts` (only if audit finds a gap)
  - `supabase/functions/email-webhook/index.ts`
  - `supabase/functions/rcs-webhook/index.ts`
  - `supabase/functions/send-reminders/index.ts`
- New files:
  - `supabase/functions/rcs-templates-push/index.ts`
  - `src/components/settings/rcs/PushTemplatesDrawer.tsx`
- Migrations:
  - Trigger `members_after_insert_provision_login`.
  - `search_path` / GRANT patches for any RPCs the audit flags.
  - Optional: index on `communication_retry_queue(status)` if EXPLAIN shows scan.

Once approved I'll implement in the order: (1) Retry Queue fix, (2) migration + audit note, (3) RCS/email delivery patches, (4) push-sync feature.
