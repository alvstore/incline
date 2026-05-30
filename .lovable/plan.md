# System Health, WhatsApp Window & Retry Storm — Fix Plan

## 1. System Health: bulk AI fix prompts + readable production errors

**Problem today**
- Each error must be opened individually to copy a fix prompt. Painful for 64 open rows.
- Frontend rows show only minified stack (`index-CrIbZcPK.js:183:53850`) — useless after build.
- Backend rows show `Meta API 404: (#132001) Template name does not exist…` with empty `function_name`, `route`, and `context` → impossible to tell *which* template / *which* member / *which* caller.

**Fix**
- **Bulk + group prompts on Errors tab**
  - Row checkboxes + a "Select all on page" header checkbox.
  - New `Generate AI Fix Prompt (N)` button in the toolbar → single combined prompt covering all selected rows (grouped by fingerprint, with counts, last-seen, route, source, top stack frame).
  - New "Group" view that automatically clusters by `fingerprint`; each group gets one "Generate group prompt" + "Mark all resolved" button.
  - Keep existing per-row prompt as a fallback.
- **Readable production errors (sourcemaps)**
  - Enable hidden source maps in `vite.config.ts` (`build.sourcemap: 'hidden'`) so generated `.map` files ship to the bundle output but are not linked from JS. Cloudflare keeps serving the site as-is.
  - In `errorReporter.ts`, before sending the stack to `log_error_event`, run it through `stacktrace-js` (`StackTrace.fromError`) when sourcemaps are reachable; persist the symbolicated frames in the new `context.symbolicated_stack` JSON.
  - System Health UI shows symbolicated stack first, raw stack collapsed below.
- **Enrich backend error context (fixes "where is 132001 coming from")**
  - `send-whatsapp/index.ts`: when Meta returns an error, call `log_error_event` (or pass through to dispatcher) with `context = { template_name, recipient_hash, member_id, branch_id, caller_function, source_log_id, meta_code, meta_subcode, fbtrace_id }` and `function_name = 'send-whatsapp'`.
  - `dispatch-communication`: propagate `source_caller` (e.g. `automation-brain:birthday_wish`, `send-broadcast`, `notify-booking-event`) into the same context.
  - Add a "Caller / Template" column to the System Health table when `source = edge_function` so the table itself answers "where is it coming from".

## 2. WhatsApp: unify 24h-window vs template decision (no more confusing 24h errors)

**Problem today**
- The dispatcher only inserts the template when the caller passes `template_id`. Direct sends (and several callers that forget `template_id`) hit the 24h pre-flight, fail with `Outside 24h customer-service window`, get queued for retry, and confuse users.

**Fix — single decision tree in `dispatch-communication`**
1. Look up the inbound 24h session (existing query, but extract into a helper `hasOpenSession(branch_id, recipient)`).
2. If session is OPEN → send freeform (current behavior).
3. If session is CLOSED:
   - If caller passed `template_id` → send that template (existing path).
   - Else → resolve a fallback template:
     - Use `category` + `branch_id` to look up the canonical template via existing `templates`/`whatsapp_triggers` mapping.
     - Fall back to a single, always-present "operational fallback" template (configured in Settings → Communication Templates) when no category match exists.
   - Only after both lookups fail, suppress with reason `no_template_for_closed_session` (no retry — terminal).
4. Never fire 131047 anymore: if a chosen template's `whatsapp_templates.status != APPROVED`, suppress immediately instead of attempting the send.
- Add a single helper `resolveWhatsAppDelivery({branch_id, recipient, category, template_id?})` returning `{ mode: 'freeform' | 'template' | 'suppress', templateName?, reason? }` and call it from one place. Removes the dual-path 24h logic that currently lives both in the dispatcher and (partially) in callers.

## 3. Stop the runaway retry loop ("Ritesh" case → DB bloat)

**Problem today**
- `process-comm-retry-queue` reschedules indefinitely whenever `dispatch-communication` returns `failed` (only `suppressed` is terminal). A recipient that permanently fails (invalid number, opted-out, closed session w/o template) keeps cycling 5min → 30min → 2h → repeat, and each attempt writes new `communication_logs` + `error_logs` + `whatsapp_messages` rows.
- `max_retries` defaults to 3 but new rows are being created by other code paths instead of incrementing the existing one.

**Fix**
- In `process-comm-retry-queue` (bump to v2.2.0):
  - Treat these dispatcher reasons as **terminal** (mark `exhausted`, no reschedule): `no_active_session_no_template`, `no_template_for_closed_session`, `template_not_approved`, `template_stale_in_meta`, `do_not_contact`, `member_pref_opt_out`, `invalid_recipient`, `recipient_unreachable`.
  - Treat Meta error codes `131026`, `131047`, `131051`, `132001`, `132012`, `133010` (recipient/template permanent) as terminal even when wrapped in `failed`.
  - Hard cap: `retry_count >= 3` → `exhausted`, regardless of reason (already in code, but enforce before re-insert paths).
- Add a Postgres trigger `tg_comm_retry_queue_dedupe` on `communication_retry_queue` insert that, when an active (`pending|processing`) row already exists for `(branch_id, recipient, type, original_log_id)`, updates the existing row's `next_retry_at`/`metadata` instead of inserting a new one. Prevents the "many rows per member" amplification.
- Add `do_not_contact` auto-flag: when a recipient hits 3 terminal failures in 24h, call existing `mark_do_not_contact` RPC so future automation skips them entirely.
- One-time cleanup migration:
  - `UPDATE communication_retry_queue SET status='exhausted' WHERE status='pending' AND retry_count >= 3;`
  - `UPDATE communication_retry_queue SET status='exhausted' WHERE status='pending' AND last_error ~* '131047|132001|132012|131051|do_not_contact';`

## Technical details

**Files**
- `src/pages/SystemHealth.tsx` — multi-select, group view, bulk prompt builder, symbolicated stack panel, "Caller / Template" column.
- `src/lib/errorReporter.ts` — symbolicate stack with `stacktrace-js`, persist into `context.symbolicated_stack`.
- `vite.config.ts` — `build.sourcemap: 'hidden'`.
- `supabase/functions/_shared/whatsappDelivery.ts` (new) — `resolveWhatsAppDelivery` helper.
- `supabase/functions/dispatch-communication/index.ts` — use the helper; emit richer `delivery_metadata` + `source_caller`; suppress (not fail) when no template available.
- `supabase/functions/send-whatsapp/index.ts` — call `log_error_event` with enriched context on Meta errors.
- `supabase/functions/process-comm-retry-queue/index.ts` → v2.2.0 terminal-reason table.
- New migration: dedupe trigger on `communication_retry_queue` + cleanup of stuck rows.

**Group prompt format (single textarea, copy-once)**
```
You are auditing N production errors on Incline Fitness.
Group A (fingerprint=xxx, 23 occurrences, source=edge_function):
  message: Meta API 404 (#132001) Template name does not exist
  function: send-whatsapp
  callers: automation-brain:birthday_wish, send-broadcast
  template_name: birthday_wish_v3
  ...
Group B (fingerprint=yyy, 5 occurrences, source=frontend, route=/system-health):
  message: TypeError: Failed to fetch
  symbolicated stack:
    at fetchErrorLogs (src/pages/SystemHealth.tsx:142)
    ...
For each group, return: root cause, file(s) to edit, exact fix.
```

## Out of scope
- Rewriting the Templates Hub itself.
- Migrating off Meta Cloud API.
- Any UI redesign beyond the bulk/group controls and symbolicated stack panel.
