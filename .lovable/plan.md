# Trainer self-service answers on WhatsApp

Gyaneshwar asked the assistant two things it could not answer: which members are assigned to him, and check-in / check-out times. The team assistant today only has business-wide tools (daily summary, expiries, renewals, dues, member lookup) and none of them are trainer-scoped, so it replied with a generic menu.

## What trainers will be able to ask

- "Which members are assigned to me?" — their own client list with member code, plan and membership expiry.
- "My check-in time today" / "my attendance this week" — their own shift punches, with hours and late marks.
- "When did Rohit last come in?" — a client's recent gym visits with entry time (and exit where recorded).
- "What is Rohit's workout plan?" / "his diet plan?" — the active plan name, duration and current week/day.
- "My sessions today" — today's PT sessions with member name, time and status.

## Access rules

- A trainer only ever sees people linked to them: assigned members, their PT-package clients, and members in classes they run. Asking about anyone else returns "that member isn't assigned to you".
- Owners, admins and managers keep full visibility and can ask the same questions about any trainer or member.
- Money stays out: no dues, no revenue, no invoice amounts for trainers — the existing financial gate is untouched.
- Members and enquiries can never reach these tools; they stay on the member and sales assistants.

## Technical notes

1. `resolveMemberContext` (ai-agent-brain.ts) already detects trainers but drops the ids. It will also return `staffUserId`, `trainerId` and the person's `branchId` on the internal-team result.
2. `ai-ops-tools.ts` gains five tools, appended for every internal role:
   - `list_my_assigned_members` — `members.assigned_trainer_id` ∪ `member_pt_packages.trainer_id`, names resolved via the two-step `members.user_id → profiles` path (no FK embed).
   - `get_my_attendance` — `staff_attendance` rows for the caller (optionally `staff_day_blocks` for the roster view), IST-formatted check-in / check-out, hours, late flag.
   - `get_member_attendance` — recent `member_attendance` rows for one client, after an assignment check.
   - `get_member_fitness_plan` — active `member_fitness_plans` (workout and diet) with plan name, dates and current week/day, after the same assignment check.
   - `list_my_sessions_today` — `pt_sessions` for the caller's trainer id on a given date (defaults today, IST).
   A shared `assertTrainerOwnsMember()` helper enforces scoping; it is bypassed for owner / admin / manager.
3. `getOpsToolDefinitions(role)` gets the trainer block; `executeOpsToolCall` gains the new cases and a `trainerId` / `staffUserId` in its `opts`.
4. `runStaffAgent` passes the new identity fields into the executor and its system prompt states the caller's own scope ("you can see only your assigned members") so the model does not promise data it cannot fetch. The existing hard rule — every figure must come from a tool call in this turn — stays.
5. No new edge functions; `whatsapp-webhook` and `meta-webhook` keep calling `runUnifiedAgent`. Deploy both webhooks after the shared files change.

## Verification

- Typecheck, then run the tool paths against real rows for Gyaneshwar's trainer record: assigned members, his own punches for today, one client's last visits, one client's active plans.
- Confirm a member id not linked to him is refused.
