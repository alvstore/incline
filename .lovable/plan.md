# Fix diet/workout plan requests: assign to the member's trainer, no duplicates

## What went wrong (confirmed)
Dr Khushi Panda (INC-26-0243) has assigned trainer, and two open diet requests:
- 9 Nov — raised by staff on her behalf, assigned to her trainer.
- 11 Nov — raised by her from the app, **Unassigned**.

1. **Unassigned:** the app looks up her trainer from the member's own phone, but members aren't allowed to read the trainer list, so it finds nobody and saves the request with no one assigned.
2. **Duplicate:** before saving, the app checks "do you already have an open request?" — but a member can only see requests *she* raised. The 9 Nov one was raised by staff, so it was invisible to her and the check passed.

Older requests (Renuka twice on 26 Oct, Harsh Bothra) show the same pattern.

## Fix
1. **One server action for plan requests** — the member's app calls it instead of saving the request itself. The server:
   - refuses if any open diet (or workout) request already exists for that member, no matter who raised it, with a clear message: "You already have a diet plan request open since 9 Nov. Your trainer will send it soon."
   - assigns it to the member's assigned trainer. If there's no trainer, it stays unassigned and branch managers/desk are alerted (as today) instead of one copy per trainer.
   - adds the member's note (meal timings, weight etc.) to the existing request when it's a duplicate, so details aren't lost.
   - notifies the trainer through the usual notification path.
2. **Requests screen:** "Request a diet plan" / "Request a workout plan" show "Request already pending" when one is open (same as freeze/locker), with the date it was raised.
3. **Clean up existing data:** merge Khushi's 11 Nov request into the 9 Nov one (copy her note, close the duplicate), and assign any open unassigned plan requests to the member's trainer where one exists. I'll show you the list before changing others.
4. **Small test:** second request while one is open is refused; request is assigned to the member's trainer.

## Technical details
- New SECURITY DEFINER RPC `create_member_plan_request(_kind text, _note text)` with `rpc_guard_applies` + self check (caller must be the member), resolves `trainers.user_id` from `members.assigned_trainer_id`, dedupe over `tasks` (linked member, title prefix, status pending/in_progress), returns `{success, task_id, duplicate_of}`. Grant to authenticated only.
- Partial unique index on open plan-request tasks per member+kind as a race backstop.
- `RequestComposerDrawer.tsx` diet/workout branch calls the RPC; `MemberRequests.tsx` adds `hasPending('diet'|'workout')`.
