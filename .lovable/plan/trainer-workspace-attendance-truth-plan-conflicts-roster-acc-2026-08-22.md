# Trainer Workspace: Attendance Truth, Plan Conflicts & Roster Accuracy

Five fixes across `/my-clients`, the trainer dashboard and `/my-attendance`.

## 1. "Last attended" on client cards

Add a visit-rhythm line to each client card on `/my-clients`: the last 3 visit days from the past 7 days, each with the arrival time (e.g. `Fri 6:12 AM · Thu 6:04 AM · Wed 7:31 AM`), plus a "usually arrives around ~6:15 AM" hint and a muted "No visits in last 7 days" state.

Data comes from the biometric turnstile feed already landing in the database (`access_logs` / `member_attendance`) — verified as live: Ritesh's own scans are flowing today. Because trainers cannot read those tables directly under RLS, a new security-definer RPC `get_trainer_client_visits(days)` returns, for the trainer's own clients only, one row per member per day: first scan time, last scan time, scan count. Multiple scans on a day collapse into one visit.

## 2. Duplicate diet / workout plans (staff vs trainer)

Verified problem: assignment inserts a new `member_fitness_plans` row unconditionally, so a member can end up with several overlapping active diet plans and several active workout plans from different authors, and the member app just shows the newest one. Nothing warns either side.

Fix — conflict-aware assignment:
- Before assigning, look up each selected member's active plan of the same type (valid today) and show a warning block in the assign drawer listing member, existing plan name, author and expiry.
- Offer an explicit resolution: **Replace** (close the existing plan by setting `valid_until` to yesterday, then insert the new one) or **Keep both** (deliberate override, recorded).
- Record the choice on the new row so the history is auditable, and log a supersede entry.
- On the member's Diet/Workout page and on the trainer's client card, show "Assigned by <name> (staff/trainer)" so ownership is never ambiguous.
- One active plan per type per member becomes the default state.

## 3. Kaushay Jain (INC-26-0007) shown in both General and Personal

Verified cause: General = members with `assigned_trainer_id` set; Personal = members with an active PT package. Kaushay satisfies both, so he is counted twice (Total 5 = 4 + 1 with an overlap).

Fix: Personal Training wins. A member with an active PT package is removed from the General list and tab count, and their card gets a "PT" badge. Totals become de-duplicated across the roster.

## 4. Duty Status says "Off Duty" while the trainer is in the gym

Verified cause: the card marks you On Duty only when a `staff_attendance` row has no check-out. For Ritesh (TR-INC-00002) today's rows are already closed (06:04 → 20:45 plus a stray 4-second 21:20 row), while his turnstile scans continue (last one this evening) — so the card falls back to "Off Duty" and offers a manual punch he doesn't need.

Fix:
- Presence is derived from the biometric feed first: a scan within the last 90 minutes means On Duty, with "Last seen 6:42 PM at <gate>" and the source shown as Turnstile.
- `staff_attendance` remains the payroll record; the card reconciles the two instead of contradicting them.
- Manual punch is only offered when there has been no scan at all in the window.
- A stray punch shorter than ~2 minutes (like today's 4-second row) is treated as noise and not shown as a shift.

## 5. `/my-attendance` — consolidate multiple check-ins + theme colors

- Collapse a day's many scans into one visit row: first in, last out, total on-site time, with an expandable punch trail showing the individual scans (same grouping model already used by the Live Access Feed).
- Filter out sub-2-minute noise punches, and label auto-closed rows so a 16-hour "shift" is visibly a system close rather than real hours.
- Colors: trainer surfaces currently hardcode blue/indigo/violet/slate utilities (26 occurrences on the dashboard, plus My Clients, Schedule Session and the shift card). These get swapped to the app's semantic theme tokens so the cards follow the theme the user selects, instead of staying blue.

## Technical notes

- New RPC `get_trainer_client_visits(p_days int)` — security definer, own-clients-only, returns member_id, visit_date, first_seen, last_seen, scan_count.
- New RPC `get_my_duty_presence()` — returns last turnstile scan time/gate for the calling staff/trainer user plus today's attendance rows.
- Plan conflict check reuses `member_fitness_plans` with a validity-window query; "Replace" closes the old row rather than deleting it.
- Roster de-dup and visit grouping are pure client-side helpers with unit-testable logic (mirroring `src/lib/devices/accessSessions.ts`).
- No changes to payroll computation or MIPS device configuration.
