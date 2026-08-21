# Fix: WhatsApp templates sending "—" + MIPS revocation never reaching hardware

Two separate root causes, both confirmed by inspection.

## 1. Lead alert message shows dashes instead of values

The internal lead alert template body is positional:
`Hi {{1}}, a new lead has been generated. Name: {{2}}, Interest: {{3}}, Source: {{4}}.`

Its stored variable labels are the generic names `variable_1 … variable_4`. The dispatcher builds the parameter list from those labels, then tries to resolve a value for the key `variable_2` — no such key exists in the payload sent by `notify-lead-created` (which sends `lead_name`, `plan_interest`, `lead_source`, `staff_name`), and the generic label matches none of the alias rules. Every slot falls through to the safe placeholder `—`, so the message ships "delivered but empty". This affects every template whose labels were auto-saved as `variable_n` — not just lead alerts.

### Fix
- In `dispatch-communication`, treat labels matching `variable_n` / `param_n` / `p_n` / blank as **unlabelled**: fall back to the numeric slot key so positional alias resolution runs.
- Add **slot semantics inferred from the template body**: for each `{{n}}`, read the words immediately before it (`Name:`, `Interest:`, `Source:`, `Hi`, `₹`) and derive a semantic key (`name`, `interest`, `source`, `amount`). Use that key for alias lookup before falling back.
- Only after both passes fail, use the safe placeholder.
- Backfill the `variables` column of templates currently storing `variable_n` labels with the inferred semantic labels, so the Templates Hub UI also shows meaningful names.
- Re-queue the two failed lead alerts so they resend correctly.

## 2. Overdue members keep hardware access (Jai Patel INC-26-0050)

Verified in the database:
- The member row is `hardware_access_status = blocked_overdue`, `hardware_access_reason = dues`.
- `evaluate_member_access_state` correctly computes the block and inserts a row into `hardware_access_events` with `requires_sync = true` — five such rows exist for this member since 19 Aug.
- **Nothing consumes that queue.** `hardware_access_events` appears only in migrations and generated types; no edge function, cron job, or worker drains it.
- `mips-access` (the function that actually writes `validTimeEnd = 2000-01-01`) is only ever invoked from the browser — membership purchase and the device fleet screen.

So the CRM knows the member is overdue, the live feed shows it, but the new end date is never pushed to the MIPS server, which keeps the original membership validity (2027-07-29) and opens the turnstile.

### Fix
- Add a server-side drain: a new automation rule `process_hardware_access_sync`, dispatched by the existing Automation Brain tick, that picks up `hardware_access_events` rows with `requires_sync = true` and calls `mips-access` (`revoke` or `restore`) per member.
- Add `synced_at`, `sync_result`, and `sync_attempts` columns so each event is claimed once, retried on failure, and auditable.
- Make the revocation instant as well as scheduled: on status change, `evaluate_member_access_state` fires the same edge call immediately via `pg_net`, with the queue acting as the retry safety net.
- Harden `mips-access`: after the `PUT /personInfo/person`, read the person back and confirm `validTimeEnd` actually equals the pushed value. If MIPS silently ignores the write (or the person lives under the employee record rather than the person record), log a `sync_result = 'mismatch'` and surface it in System Health instead of reporting success.
- Backfill: run the drain once for all members currently in `blocked_overdue` / `expired` / `blocked_member_status` so the hardware catches up, and verify Jai Patel's validity end reads `2000-01-01` afterwards.

## Technical notes
- `supabase/functions/dispatch-communication/index.ts`: `orderedTemplateKeys`, `resolveVarValue`, new `inferSlotSemantics(content)` helper; version bump to v1.30.0.
- New migration: columns on `hardware_access_events`, `pg_net` dispatch in `evaluate_member_access_state`, seed row in `automation_rules`.
- New edge function `process-hardware-access-sync` (service-role bearer, same worker contract as `send-reminders`).
- `supabase/functions/mips-access/index.ts`: read-back verification, version bump.
