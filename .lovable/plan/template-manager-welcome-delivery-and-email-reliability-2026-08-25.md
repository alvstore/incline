# Template Manager, Welcome Delivery, and Email Reliability

## Confirmed findings
- Both `welcome_new_member` (Utility) and `welcome_incline_fitness` (Marketing) are approved and synchronized, but neither is mapped to the `member_created` event. This is why the dispatcher reports no usable template.
- The template catalog sync already imports the full Meta catalog and mirrors approval state, but it does not reconcile approved templates to their declared system events.
- Recent email activity contains successful sends plus failed/dead-lettered queue attempts. No recent email log itself contains the old “provider never returned” text; that message comes from the separate communication-log reaper.
- `payroll_rules` exists with zero rows and no dependent payroll columns; `device_commands` must remain because it powers turnstile command delivery.
- The System Health page still renders the misleading empty/unused-table card.

## Implementation

### 1. Repair welcome delivery
- Map `member_created` to the approved Utility template `welcome_new_member` for the active branch.
- Keep `welcome_incline_fitness` available for marketing campaigns, but do not use it as the default account-created message.
- Make the mapping idempotent and verify the dispatcher resolves the approved template with all required variables.

### 2. Add a bounded Template Manager worker
- Add a scheduled worker under Automation Brain that runs one bounded branch batch at a time.
- Synchronize the complete Meta catalog, update local approval/stale/rejection states, and reconcile approved templates to canonical system events.
- Never duplicate or resubmit templates already pending or approved.
- Record each run, mappings created, gaps remaining, and provider errors so System Health can show actionable status.
- Use a persisted lease, idempotent progress, a fixed work cap, and pause/circuit-breaker behavior for authorization, credit, and repeated rate-limit failures.
- Missing templates may be drafted and submitted for review, but the UI will accurately say “Submitted for Meta review”; Meta approval cannot be guaranteed or bypassed.

### 3. Harden Email delivery status
- Keep managed email as the primary path and Hostinger SMTP only where attachments or queue rejection require fallback.
- Add a strict total SMTP time budget shorter than the function execution limit, close sockets on timeout, and return a structured failure rather than leaving a send in `sending`.
- Correlate queue `message_id`/idempotency keys back to communication logs so a later queue success updates the originating record instead of being reaped as failed.
- Preserve bounded retry and dead-letter behavior; surface the final provider reason.

### 4. Fix Template Studio submission and status language
- Preserve generated variable metadata and media sample data when submitting templates.
- Show explicit states: Local Draft, Submitted, Pending Review, Approved, Rejected, Pending Deletion, and Stale.
- After a catalog sync, invalidate coverage queries so approved Meta templates disappear from “Missing” immediately.

### 5. Clean System Health and database audit
- Remove the “Database Audit — Empty/Unused Tables” card from System Health.
- Drop only the confirmed orphaned `payroll_rules` table and its update trigger.
- Retain `device_commands`; do not touch other tables.

## Verification
- Run the welcome-template resolution path and confirm `member_created` selects `welcome_new_member` without `no_template_for_closed_session`.
- Invoke the template worker twice and confirm the second run creates no duplicates.
- Sync the Meta catalog and confirm approved/pending/stale states match the provider response.
- Send a controlled email through the managed queue and an attachment email through fallback; confirm one terminal communication status for each.
- Run backend lint/health checks and verify the app build plus System Health and Template Studio UI.
