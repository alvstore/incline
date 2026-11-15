# Trainer match for members without a trainer

## What the audit found
- 120 members with an active plan have no assigned trainer (100 already have one).
- 7 active trainers. Their working hours exist in the staff shift roster (morning/evening per weekday, plus day overrides); the older "trainer availability" table is empty and will not be used.
- Gate check-ins are rich (about 2,660 visits in the last 30 days), so each member's usual visit time can be worked out reliably.
- Today, "Assign Trainer" is one member at a time and only shows trainer load, not whether the trainer is actually on the floor when the member trains. There is no list or download of unassigned members.

## What we will build

### 1. "Usual visit time" per member
From the last 60 days of gate check-ins (IST, same-day bounce scans counted once):
- Usual window, e.g. "Mostly 6:30–7:30 AM, Mon–Sat", plus Morning / Afternoon / Evening label.
- Visits counted, and a confidence label: Strong (8+ visits), Some (3–7), Not enough (under 3, e.g. new joiners).

### 2. Trainer fit score
For each unassigned member, every active trainer of the same branch is ranked on:
- Overlap between the member's usual window and the trainer's rostered shift (main factor), respecting weekly offs.
- Spare capacity against the trainer's client limit (full trainers shown but marked "At capacity").
- Gender preference only if the member has one saved.
Shown as "Best match", "Good", "Not on shift at that time".

### 3. New "Unassigned members" view (Trainers page tab)
- Table: member, plan, usual time, visits, best trainer with overlap %, second option.
- Filters: time of day, confidence, plan type; search.
- Actions: Assign best match (one click), choose another trainer (opens existing Assign Trainer side panel, now with the fit score), and select several then "Assign suggested" in bulk with a confirm step.
- Download as CSV / Excel (this is the missing list), respecting current filters.
- Trainer load strip on top: each trainer's clients vs limit and their shift hours, so managers see balance before assigning.
- Smooth entrance motion matching Approvals/Tasks; works on phone.

### 4. Existing Assign Trainer panel
Adds the member's usual time and a fit badge on each trainer card. Nothing else changes.

### 5. Safe rollout
- Behind a switch `trainer_match_v1`, on for owners/admins/managers first.
- Managers see only their own branch; trainers cannot see this view.
- Assigning still uses the current assignment path, so trainer notifications and audit history keep working.
- Members on PT keep their PT trainer shown for context; we never change PT packages.

## Out of scope
- Automatic assignment without a human click.
- Changes to PT pricing, payroll or commissions.

## Technical details
- Read-only SECURITY DEFINER RPC `trainer_match_suggestions(p_branch_id, p_days default 60)`, with `rpc_guard_applies` + branch/role checks, granted to authenticated. Server-side aggregation (histogram of check-in hour × weekday from `member_attendance`, deduped per member/day) joined with `staff_shifts` + `staff_shift_overrides` and active `trainers` (client count vs `max_clients`). Returns one row per unassigned member with top 2 trainers; no row downloads to the browser.
- Supporting index on `member_attendance (member_id, check_in)` if missing.
- Bulk assign: RPC `bulk_assign_trainers(jsonb)` looping the existing assignment logic, capped at 50 per call, audited; notifications via existing `notifyTrainerAssignment`.
- UI: `src/pages/Trainers.tsx` new tab, `src/components/trainers/UnassignedMembersPanel.tsx`, CSV export helper, fit badge in `AssignTrainerDrawer.tsx`. Flag through the existing feature flag table.
- Tests (bun:test): overlap scoring (in-shift > partial > off-shift), weekly-off excluded, at-capacity marked, under-3-visits = "Not enough".
