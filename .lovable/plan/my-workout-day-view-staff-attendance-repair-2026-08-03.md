# My Workout day-view + Staff attendance repair

## 1. /my-workout — day-wise + full-week views

Today the member page renders every day of the plan as a flat grid of cards. Add a proper day experience without losing the week overview.

- **Segmented switch** at the top of the plan: **Today · Day view · Full week** (defaults to Today's session when the plan has a day matching the current weekday, otherwise Day 1).
- **Day view**: a horizontal day rail (Mon…Sun chips with muscle-group label, exercise count, and a rest-day state), then one focused card with:
  - hero band showing day name, focus/split, total exercises, estimated duration,
  - each exercise as a row: index badge, name, sets × reps, rest, tempo/notes, plus a local "done" tick that persists per day for the current date (client-side only, no schema change),
  - a session progress bar (x/y exercises done) and Previous/Next day navigation.
- **Full week**: keeps the current grid but upgraded — compact cards, rest days rendered explicitly, and a click on any card jumps into Day view for that day.
- Mobile-first: day rail is a scrollable chip row, exercise rows stack, sticky segmented control.
- PDF plans (`source_kind === 'pdf'`) keep the existing embedded viewer — the switch is hidden there.
- Styling stays on existing tokens (rounded-2xl, soft shadows, accent gradients); no new colors.

## 2. Staff attendance — why "on-time trainers show no attendance"

Two separate, verified causes.

### 2a. The Staff Check-in tab only shows *open* sessions

The Status column is driven by "has a row with no check-out". Everyone who scanned in **and** scanned out today therefore reads **Not Checked In**, even though the attendance row exists. Live data for 03 Aug confirms rows exist for Ritesh (06:31→10:01), Harshwardhan (06:09→10:24), Govind (07:00→09:38), Bhagirath (08:13→09:59), Kunal (00:09→06:05), while only Gyaneshwar is still open — exactly matching the screenshot.

Fix: make the row show today's real state — **Present (in 06:31 · out 10:01)**, **Checked In (since …)**, **Not Checked In**, **Weekly off** — with a late/on-time chip from the stored `is_late` / `late_minutes`, and keep the Check In / Check Out action driven by the open-session state.

### 2b. Puneet Meghwal's face is enrolled under a dead identity

His gate scans today (10 scans from 05:58) come in as `personSn = EMPMS43FQIG`, but that employee record no longer exists — the CRM now knows him only as trainer `TRNE5C9`. Every scan resolves to "not matched in CRM", so no attendance row is written and he reads absent. The same applies to the four device-only persons (`STAFF1` Kajal, `STAFF2` Rohit, `ADMIN` Rajat, `Admin2` Yogita), which were created directly on MIPS and have never been linked to a CRM user. Lokendra genuinely has no scan today.

Fix:
- Add a **person alias** mapping (device person code → CRM user/trainer/employee/member) consulted by the webhook receiver and by `reconcile-mips-pass-records` after the existing `mips_person_sn` / code lookups, so legacy or manually-created device codes resolve.
- Add an **Unmatched persons** panel in the Device Command Center listing distinct unresolved `personSn` values from the last 30 days with scan counts, and a side drawer to link one to a staff member or member — linking writes the alias, backfills attendance for that person's scans, and queues a re-sync so MIPS gets the canonical code.
- Seed the alias for `EMPMS43FQIG → Puneet Meghwal` and backfill his 03 Aug attendance from the gate scans.
- Also stamp `mips_person_id` for trainers missing it (Bhagirath, Puneet) during the next sync so numeric-ID matching works as a second path.

### 2c. Bad late values on existing rows

Stored lateness is inconsistent (Ritesh 02 Aug: `late_minutes = 959` with `is_late = false`; Bhagirath 03 Aug: 133 min against a `full_day` shift). Recompute `scheduled_start` / `late_minutes` / `is_late` for the last 14 days through `resolve_staff_shift`, and stop `full_day` rows from being scored against a morning start when the roster has no matching block.

## Technical notes
- Frontend: new `src/components/member/workout/` components (`DayRail`, `DaySessionCard`, `WeekGrid`) consumed by `src/pages/MyWorkout.tsx`; `AttendanceDashboard.tsx` Staff Check-in table switches from `checkedInUserIds` to a per-user today-summary map built from `staff_attendance` (already fetched for the branch/date).
- Migration: `mips_person_aliases` table (person_code unique, target type + id, created_by, timestamps) with GRANTs and manager/admin-only policies; alias-aware resolver function; backfill statements for Puneet and for late recomputation.
- Edge functions: `mips-webhook-receiver` and `reconcile-mips-pass-records` gain the alias lookup plus a name-based last-resort match logged as "low confidence" rather than silently dropped.
