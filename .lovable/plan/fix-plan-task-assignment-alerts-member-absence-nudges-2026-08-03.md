# Fix plan: task-assignment alerts + member absence nudges

## What I found (verified against live data)

**1. Task assigned to Yogita Lekhari produced zero notifications — anywhere.**
- The database trigger `tasks_notify_assignee` inserts a notification with `type = 'task'`, but the `notifications` table has a CHECK constraint allowing only `info | success | warning | error | reminder`. The insert fails, and the trigger swallows the error (`EXCEPTION WHEN OTHERS THEN NULL`). Confirmed: the two "Diet plan request from Kritesh Mali" tasks created today have **no** matching notification rows.
- There is no WhatsApp/Email path at all for task assignment — no `task_assigned` event in the template catalog, and no template rows for it.

**2. Kirti Bhaira received no absence nudge — two separate causes.**
- The retention worker runs daily at 03:30 and is healthy. Stage 1 fires at **5 days** absent. Kirti's last visit was 29 Jul, so she only crossed the threshold today, after the run — she was never eligible on days 3–4.
- More importantly, **every WhatsApp retention nudge for the last week was suppressed** with `no_template_for_closed_session — no approved WhatsApp template found for category retention_nudge`, even though approved templates (`retention_value_add_nudge`, `retention_commitment_reminder`, `retention_final_win_back_offer`) exist and are bound to `retention_stage_1/2/3`. The dispatcher resolves templates only from a coarse category map (`retention_nudge → retention_nudge, inactive_member, comeback`) and never looks at the `event_key` the worker already sends. Only Email went out; WhatsApp and SMS did not.

## What I'll change

### A. Task assignment notifications (in-app + WhatsApp + Email)
- Fix the `tasks_notify_assignee` trigger: valid `type = 'info'`, `category = 'task_assigned'`, task id in metadata, keep the deep link to `/tasks?id=…`. Re-raise nothing, but stop silently dropping valid rows.
- Add `task_assigned` to the canonical system event catalog (internal/staff-facing) so it appears in the Templates Hub coverage matrix and AI template generator.
- Seed an Email template for `task_assigned` (works immediately) with variables: assignee name, task title, member name, priority, due date, link.
- Wire outbound delivery: when a task is created with an assignee or reassigned, dispatch to the assignee's phone and email through `dispatchCommunication` (`category: 'task_reminder'`, `event_key: 'task_assigned'`, stable dedupe key `task_assigned:<task_id>:<channel>`). This covers member requests too, since those already flow through the same task creation path.
- WhatsApp for this event needs a Meta-approved template; until one is approved the dispatcher records a clean suppression while in-app and email still land. I'll queue the template text so it can be pushed for approval from the Templates Hub.

### B. Retention / absence nudges actually reaching WhatsApp
- Dispatcher: resolve the template by `payload.variables.event_key` against `templates.trigger_event` **before** falling back to the category map. This immediately unblocks `retention_stage_1/2/3` WhatsApp sends, and benefits every other worker that passes an event key.
- Extend the category map so `retention_nudge` also covers `retention_stage_1/2/3` and `retention_nudge_t1/t2` as a second line of defence.
- Retention worker: make the absence threshold configurable and lower Stage 1 to **3 days** so a member like Kirti is nudged on day 3 instead of day 5 (Stage 2 and 3 thresholds shift accordingly: 7 and 14 days).
- Audit why SMS produced no log row for retention sends and fix the silent skip so every configured channel either sends or records a reason.

### C. Verification
- Re-run the retention worker manually after the fix and confirm WhatsApp rows move from `suppressed` to `sent` in the communication log.
- Assign a test task and confirm the in-app bell, email, and (once approved) WhatsApp all fire.

## Technical notes

- Migration: replace `public.tasks_notify_assignee()`; insert the `task_assigned` email template row (branch-scoped, `trigger_event = 'task_assigned'`); update `retention_templates.days_trigger` to 3 / 7 / 14.
- `supabase/functions/dispatch-communication/index.ts` → v1.24.0 (event-key-first template resolution), redeploy.
- `supabase/functions/run-retention-nudges/index.ts` → threshold driven by the lowest `days_trigger` instead of a hardcoded 5, plus explicit SMS skip logging; redeploy.
- `src/services/taskService.ts` + `src/lib/tasks/memberRequestTasks.ts` → assignee notification dispatch on create/assign.
- `src/lib/templates/systemEvents.ts` → new `task_assigned` event.
- No changes to task RLS, approval queue behaviour, or existing task UI.
