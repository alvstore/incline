# Communication Template Manager, Email Reliability, and Database Audit Fix

## Verified findings

- `welcome_incline_fitness` and `welcome_new_member` both exist locally, are active, and are live/approved in the Meta catalog mirror. The welcome failure occurred because there is no `member_created` row in the event-to-template mapping table. The dispatcher therefore could not select either approved template outside the 24-hour WhatsApp session.
- The two welcome templates currently compete for the same event. The utility template is the safer default because the marketing version is more exposed to Meta pacing error `131049`.
- The failed email shown in System Health was not a Hostinger rejection: the managed email log records two successful deliveries to that address at the same time the communication log was marked `send_timeout: provider never returned (reaped)`. This is status drift between the asynchronous email queue and the main communication log.
- Historical managed-email failures were caused by missing plain-text and unsubscribe fields. The current sender already supplies both, and newer sends are succeeding.
- There is no scheduled template-health worker today. Sync, gap detection, AI generation, submission, and event wiring are split across manual UI actions.
- `role_permissions` and `permissions` are already absent. `payroll_rules` is empty and has no code, function, view, trigger, or foreign-key dependents. `device_commands` is active infrastructure used by the device service and realtime command-status subscription, so it must not be deleted.

## 1. Repair welcome messages immediately

- Add an idempotent `member_created` mapping to the approved `welcome_new_member` utility template for the active branch.
- Keep `welcome_incline_fitness` available in the catalog, but do not use the marketing version as the automatic welcome default.
- Harden event resolution so approved, non-stale templates are matched with normalized names and the explicit event mapping cannot silently point to an obsolete template.
- Ensure the welcome variable contract maps slot 1 to the member name and slot 2 to the purchased membership/plan name, with a safe fallback when registration has not yet created a membership.

## 2. Add a bounded Template Manager worker

Create one scheduled worker governed by the existing Automation Brain. It will cover WhatsApp, Email, SMS, and RCS without pretending that Meta approval can be automated or guaranteed.

Per run it will:
1. Acquire a database lease so only one run can execute.
2. Sync the current WhatsApp catalog from Meta before evaluating gaps.
3. Compare every channel against the canonical system-event catalog.
4. Auto-repair safe local drift: normalized name matching, stale-status refresh, missing event mappings, and duplicate mappings.
5. Draft only genuinely missing templates; validate required placeholders and channel-specific constraints.
6. Submit at most a small fixed number of WhatsApp drafts per run. Pending templates remain pending and are never resubmitted while Meta reviews them.
7. Monitor approval/rejection status on later runs and surface the exact rejection reason. Meta remains the approval authority.
8. Persist item-level progress, run history, and paused state. Stop on authentication/policy/billing errors and after bounded rate-limit retries.

The Templates Hub will show last worker run, per-channel coverage, pending approval, rejected/stale items, mapping conflicts, and a manual “Run audit” action. The AI generator and the worker will share the same coverage rules so they cannot disagree.

## 3. Fix email status reconciliation and fallback behavior

- Carry the originating communication-log ID through the managed email queue payload.
- Update the canonical communication row from queue outcomes (`sent`, `failed`, `dlq`, `suppressed`) instead of allowing the generic stuck-send reaper to guess incorrectly.
- Make the reaper check the managed email log before marking an email timed out; if the queue already sent it, reconcile it to `sent` rather than retrying and risking a duplicate.
- Keep managed email as primary. Use Hostinger only when enqueueing is unavailable or for supported attachment flows; cap the whole SMTP conversation below the function execution ceiling and return a structured timeout instead of hanging.
- Preserve idempotency across managed delivery, retry, and SMTP fallback so one event cannot send twice.
- Surface the actual provider and terminal reason in System Health rather than the misleading generic timeout.

## 4. Remove the misleading unused-table audit

- Remove the “Database Audit — Empty/Unused Tables” card from System Health; row count alone cannot determine whether infrastructure is unused.
- Drop only `payroll_rules`, after one final dependency check in the migration.
- Do not recreate or touch the already-removed `permissions` and `role_permissions` tables.
- Keep `device_commands`; it backs device commands and live command status even when its current row count is zero.

## 5. Verification

- Trigger a welcome send for a controlled test member and verify the utility template is resolved, both variables are populated, and the main communication row reaches the same terminal state as the provider log.
- Run the Template Manager twice and confirm the second run is idempotent: no duplicate templates, mappings, submissions, or jobs.
- Test approved, pending, rejected, stale, and unmapped WhatsApp fixtures plus Email/SMS/RCS coverage.
- Exercise managed-email success, queue rejection, SMTP fallback, SMTP timeout, and delayed queue completion; confirm no false `send_timeout` and no duplicate delivery.
- Verify the Templates Hub and System Health in the running app, then check build/runtime logs and deploy the changed backend functions.

## Technical scope

- Database migration: welcome trigger mapping, worker lease/progress state, Automation Brain rule, safe `payroll_rules` removal, and grants/RLS for any new worker state.
- Backend functions: template audit worker, Meta sync/idempotency hardening, dispatch template resolution, email queue correlation, timeout reconciliation, and bounded SMTP fallback.
- Frontend: Templates Hub worker health/actions and removal of the unused-table card from System Health.
