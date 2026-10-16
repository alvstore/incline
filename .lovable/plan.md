# Change-trainer request: show current trainer + capture the reason

## What's wrong (confirmed in the code)
1. **The current trainer never shows.** The request page passes `member.trainer.full_name` to the drawer, but the member data now carries the trainer as `member.assigned_trainer` (from the trainer list members can safely read). The old field is always empty, so every member, Mohit included, sees "No trainer is assigned to you yet."
2. **PT trainers are ignored.** The drawer only checks the general assigned trainer. A member whose coach comes only from an active PT package (like Bhagirath for Mohit) would still look like they have no trainer.
3. **No clear reason is saved.** The request saves one free-text note as `reason`. The Approval Queue looks for `currentTrainerName` and `memberName`, which are never saved, so managers see "Current Trainer: None" and can't tell what went wrong.

## What changes

### Member drawer (two states)
- **Trainer assigned:** a card with the trainer's photo or initials, name, and source ("Personal training" or "General coach"), plus the PT package end date if there is one. Below it:
  - A required choice of reason, shown as large tappable options: Schedule doesn't match · Not satisfied with guidance · Communication / punctuality · Want a different training style · Personal comfort / prefer other gender · Other.
  - Details box: required when the reason is "Other", "Not satisfied" or "Communication"; optional otherwise (10–500 characters).
  - Optional preferences: preferred trainer from the branch list ("No preference" by default) and a preferred time slot (Morning / Afternoon / Evening).
  - A private-handling line: "Your feedback goes to the branch manager, not your trainer."
- **No trainer:** the title becomes "Request a trainer", with a friendly empty card (icon + "You don't have a trainer yet"), goal options (Weight loss, Strength, Mobility, Rehab, General fitness), time slot, optional preferred trainer and notes. No reason step.
- If the member has several trainers (general + PT), they choose which one the request is about.

### Who gets told (escalation)
- The task for a trainer change goes to the **branch manager / front desk, not the current trainer**. Today it goes to the trainer being complained about.
- Reasons like "Not satisfied" or "Communication / punctuality" create a **high-priority** task.

### Approval Queue
- The trainer-change card shows member name and code, current trainer (with source), reason as a coloured label, details, preferred trainer and time slot. Older requests still display using whatever they saved.

### Kill switch
- One setting, `trainer_change_reason_required` (on by default). Turning it off goes back to the single free-text note, so the new flow can be switched off without a code change.

## Accessibility
- Reason and goal options are a proper radio group, usable with the keyboard, with visible focus rings and 44px touch targets.
- Required fields are marked and their errors are announced to screen readers.
- Trainer avatar has alt text, with an initials fallback.
- Submit button is disabled with a spinner while sending.

## Technical details
- `MemberRequests.tsx`: pass `assignedTrainer` (from `member.assigned_trainer`) and the active PT trainers (from `useMemberData` package rows using `trainerMap`) instead of `trainerName`.
- `RequestComposerDrawer.tsx`: add the trainer card and reason/goal section for `kind === 'trainer'`; validate with zod; save into `request_data`: `current_trainer_id`, `current_trainer_name`, `current_trainer_source`, `reason_code`, `reason`, `preferred_trainer_id/name`, `preferred_slot`, `goal`, `memberName`, `memberCode`. Use `createTask` priority `high` for the escalation reasons, assigned to branch staff instead of `trainerUserId`.
- `ApprovalQueue.tsx`: update the trainer_change renderer, falling back to the old keys (`currentTrainerName`, `reason`).
- `requestTypes.ts`: export `TRAINER_CHANGE_REASONS` and `isEscalationReason()`; add unit tests in `requestTypes.test.ts` (reason required when the flag is on, escalation reasons give high priority, "Other" requires details).
- The flag reads from the existing `settings` table (global row, default true). No new tables and no schema change.
- Verify with Playwright as Mohit (Bhagirath shown, reason required) and as admin (Approval Queue shows the reason).
