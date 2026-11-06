# Treadmill & Cardio — audit and simple plan

## Who actually needs this data

| Data | Member | Trainer | Staff/Manager |
|---|---|---|---|
| Completed runs (distance, time, calories, pace, heart rate) | Yes — their own progress | Yes — only their own PT clients, to adjust programs | No real daily use |
| Live treadmill screen (speed/incline right now) | Yes — on their phone while running | Not needed — they're on the floor and can see the machine | Not needed |

Verdict: this is mainly a **member feature**. Trainers benefit only from their clients' completed runs. A live "floor view" for staff adds cost (constant live updates) with little value, so it is left out.

## Problems found in the supplied setup (will NOT be copied as-is)

1. **Anyone signed in could read and change everyone's live treadmill data** (the live table allowed all users full access). That exposes heart rate (health data) and lets one member overwrite another's session.
2. The trainer/admin rule checks a "role" column on members that doesn't exist — it would fail or silently block.
3. History could be inserted for any member by guessing their ID.
4. Phone notification fix (use message instead of body) — **already done** last time; no change needed.

## What gets built

1. **Two tables for the Flutter app** (same columns as supplied, so the app team's code fits):
   - live session: a member can only see/update their own row; live updates on for their own phone only.
   - completed runs: member reads/adds only their own; trainer reads only clients they own; owner/manager read their branch. No editing or deleting of finished runs.
2. **Member web — My Progress page**: new "Cardio & Treadmill Runs" card (last runs with km, duration, calories, pace min/km, incline %, heart rate) plus loading/empty states. Hidden entirely when the member has no runs.
3. **Trainer**: same card visible on a client's progress view (read-only).
4. **Flutter guide**: add a short section to the existing Flutter doc with the exact read/write calls.

Skipped: staff live floor view (can be added later if wanted).

## Technical details

- Tables `treadmill_live_sessions`, `treadmill_workouts`; add `branch_id` (filled from the member by trigger, never trusted from the client); GRANT select/insert/update to authenticated, all to service_role.
- Policies use `(SELECT …)`-wrapped helpers: own member via `members.user_id = auth.uid()`, trainer via existing `_trainer_owns_member`, managers via `managed_branch_ids()`, owner/admin via `has_any_role`.
- Realtime publication on live table only; RLS limits subscribers to own rows.
- Simple duplicate guard: unique `(member_id, session_id)` on runs.
- Tests: policy checks for member-own / other-member denied / trainer own-client.
