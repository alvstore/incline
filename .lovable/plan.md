# Fix: "no approved template" for Mayuri's trainer message (utility only)

## What happened (checked)
- Mayuri Sisodia's "coach Bhagirath Gurjar has been assigned" WhatsApp (16 Oct, 18:57) was held back with `no_template_for_closed_session`.
- The right Meta-approved UTILITY templates already exist: `member_coach_welcome_notice` (member) and `trainer_assignment_notice` (trainer). But both are switched **off** in Communication Templates, so the sender never found them.
- The only fallback for this type of message (`service_update_notice`) is a MARKETING template, which we correctly refuse to use for a utility message — so the message died.
- Same problem hit "new workout/diet plan assigned" messages on 15 Oct (Yogesh, Amit, Sonu) — approved utility templates `workout_plan_ready_doc` / `diet_plan_ready_doc` exist but are not linked to these events.

## Fix
1. Switch on the two approved trainer-assignment templates and link them to their events.
2. Make the sender pick a template by the message's own event first (e.g. "member trainer assigned", "workout plan assigned") before any generic fallback.
3. Link "workout plan assigned" and "diet plan assigned" messages to the approved utility plan templates.
4. Never fall back to a marketing template for these utility messages; if none exists, keep the in-app message and email and flag it in System Health (as today).
5. Re-send Mayuri's coach-welcome message once (utility template), plus Bhagirath's trainer notice if it was also held; re-send the 15 Oct plan notices for Yogesh, Amit and Sonu.

## Verification
- Check Mayuri's message shows delivered/sent with `member_coach_welcome_notice`.
- Add a small test: a "member trainer assigned" message resolves to the utility template, never a marketing one.

## Technical notes
- Data: set `is_active=true` on templates `94fc83cc…` and `7a37a96f…`.
- `dispatch-communication`: before `CATEGORY_TO_TRIGGER_EVENTS`, resolve `payload.variables.event_key` against `templates.trigger_event` (active + APPROVED + UTILITY); add `member_trainer_assigned`, `trainer_member_assigned`, `workout_plan_ready`, `diet_plan_ready` to the `transactional` list; bump version and redeploy.
- Plan-assigned senders: pass `event_key` `workout_plan_ready` / `diet_plan_ready` with matching variables.
- Re-sends go through `dispatchCommunication` with fresh dedupe keys.
