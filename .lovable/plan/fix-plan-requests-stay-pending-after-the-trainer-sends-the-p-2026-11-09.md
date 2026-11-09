# Fix: plan requests stay "Pending" after the trainer sends the plan

## What I found (Shakeel Makrani)
- Two "Workout plan request" tasks exist:
  - 3 Nov, 9:21 pm — assigned to the trainer, status **In progress**.
  - 4 Nov, 11:13 am — a duplicate with **no trainer** (this is the "Unassigned" one), already Cancelled.
- The trainer did send a workout plan: **MUSCLE GAIN PROGRAM** on 4 Nov, 5:47 pm (and a diet plan on 7 Nov).
- Nothing connects "plan sent" to the request, so the request stays Pending for the member and open for staff. Nothing closes it automatically; the trainer would have to mark it done by hand.

## Fix
1. **Close requests automatically when a plan is sent:** when a workout (or diet) plan is assigned to a member, any open request of the same kind for that member is marked Completed, credited to whoever assigned the plan, with a note naming the plan. A matching request with no trainer yet also gets that person as its owner.
2. **Stop duplicate requests:** the member's request form won't create a second request while one of the same kind is still open (both on screen and in the database).
3. **Hide cancelled tasks from the dashboard list** so old duplicates no longer show up as "Unassigned".
4. **Fix existing data:** mark Shakeel's open workout request Completed (linked to MUSCLE GAIN PROGRAM), then apply the same fix to any other member whose open request already has a matching plan sent after it.

## Checks
- Check that Shakeel's request now shows Completed in Member Requests and is gone from the open tasks list.
- Test that assigning a plan closes a matching open request and leaves requests of the other kind (diet vs workout) open.

## Technical details
- Add an AFTER INSERT trigger on `member_fitness_plans` that updates `tasks` where `linked_entity_type='member'`, `linked_entity_id=member_id`, title starts with `<Workout|Diet> plan request`, and status is pending or in progress → `completed`, `completed_at=now()`, `assigned_to=coalesce(assigned_to, created_by)`. Make it SECURITY DEFINER with a pinned search_path and EXECUTE revoked, and wrap it in an exception handler so a plan can always be assigned.
- Add a partial unique index or guard on open plan-request tasks for each member and kind, and handle the conflict message in `RequestComposerDrawer.tsx`.
- Exclude `status='cancelled'` from the `TaskPulsePanel` query.
- Do a one-time backfill update in the same migration.
