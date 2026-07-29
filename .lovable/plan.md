# System Health Cluster Fix Plan

## Cluster 1 — `staff_check_in` overload ambiguity (PostgREST 300)

**Root cause:** Two overloads exist with the same required 3 args:
- `staff_check_in(p_user_id uuid, p_branch_id uuid, p_notes text)` (legacy)
- `staff_check_in(p_user_id uuid, p_branch_id uuid, p_source text, p_notes text)` (newer)

The client (`staffAttendanceService.ts`) sends `{p_user_id, p_branch_id, p_notes}` — PostgREST can't disambiguate because both match. Same duplication exists on `staff_check_out` (`(p_user_id)` and `(p_user_id, p_notes)`).

**Fix (migration):**
- `DROP FUNCTION public.staff_check_in(uuid, uuid, text);` (legacy 3-arg)
- `DROP FUNCTION public.staff_check_out(uuid, text);` (legacy 2-arg)
- Keep the newer versions as the single canonical entrypoints.

No client change needed (existing call sends `p_notes` only; new function has `p_source` optional default).

---

## Cluster 2 — 403 on `member_onboarding_signatures` (INSERT during self-registration)

**Root cause:** Table has policies for staff read/manage but **no INSERT policy for the member creating their own signature** during onboarding at `/members` finalize step. The service-role or self-register path is currently blocked when performed as `authenticated` (member).

**Fix (migration):** Add scoped INSERT + SELECT policies:
- `INSERT` allowed when `member_id` belongs to `auth.uid()` (via `members.user_id`).
- `SELECT` allowed for that same member.
- Keep existing staff policies untouched.

---

## Clusters 3 & 5 — Automation Brain 502 cold-start (shared cause)

**Root cause:** Supabase edge gateway occasionally returns 502 on cold-start for infrequently-invoked functions (`process-scheduled-campaigns`, `reconcile-mips-pass-records`). Already logged as `warning` (not error), but retriable transient.

**Fix (single change in `supabase/functions/automation-brain/index.ts`):**
- When response status is 502/503/504 AND body indicates cold-start, sleep 1500 ms and retry once before logging.
- Downgrade the log to `severity=info` if the retry succeeds (only log warning if second attempt also fails).

---

## Cluster 4 — Frontend "Script error." at `:0:0` (iOS Safari)

**Root cause:** Cross-origin script (likely a CDN'd library or the Lovable badge) throws without CORS headers → browser masks it as `Script error.` with no stack. Not actionable, floods System Health.

**Fix (`src/lib/errorReporter.ts` + `ErrorBoundary`):**
- Skip reporting when `message === 'Script error.'` AND `filename`/`lineno`/`colno` are all empty/0.
- Also add `crossorigin="anonymous"` to any manually-inserted `<script>` tags we control in `index.html` (audit only; leave third-party as-is).

---

## Cluster 6 — FK violation in `biometric_sync_queue` for trainers

**Root cause:** `tg_push_photo_to_mips` inserts trainer ids into `biometric_sync_queue.staff_id`, but that column FKs to **`employees(id)`**, not `trainers(id)`. Trainers who aren't also in `employees` fail the FK.

**Fix (migration — trigger patch):**
- In `tg_push_photo_to_mips`, when `person_type='trainer'`:
  - Resolve the matching `employees.id` via `employees.user_id = trainers.user_id` (or skip queue insert if no match — the `net.http_post` to `sync-to-mips` still fires, which is the real work).
- Wrap the queue insert in its own `BEGIN…EXCEPTION WHEN foreign_key_violation THEN NULL` so a missing employee row never breaks the trigger.

---

## Item 2 — Attendance for staff / trainer / member on their dashboards

**Audit result:**
- Member: `useAttendance` + `member_check_in`/`member_check_out` — works; `MyAttendance.tsx` renders from `member_attendance`. OK once MIPS reconcile keeps writing (already fixed last turn).
- Staff/Trainer: `useStaffAttendance` → `staff_check_in`/`staff_check_out` — **currently broken by Cluster 1 overload ambiguity**. Fixing Cluster 1 restores it.
- Trainer dashboard: currently reads only `staff_attendance` rows keyed by `user_id`. The MIPS reconcile edge fn already writes staff attendance when `person_type='employee'` — need to also mark attendance for `person_type='trainer'` (currently only members + employees get auto-attendance).

**Fix:** In `supabase/functions/reconcile-mips-pass-records/index.ts`, extend the auto-attendance branch to also insert into `staff_attendance` when the matched person is a trainer (using their `user_id`).

---

## Item 3 — Live Access Feed realtime

**Current state:** `LiveAccessLog.tsx` triggers `reconcile-mips-pass-records` every 15s and refetches `access_logs`. Not truly realtime.

**Fix:** Add a Supabase Realtime subscription in `LiveAccessLog.tsx` on `access_logs` (filtered by branch when set) that calls `queryClient.invalidateQueries(['access-logs-live'])` on INSERT. Keep the 15s reconcile poll as a safety net (MIPS webhook + poll + realtime).

Also enable realtime replication on `access_logs`, `member_attendance`, `staff_attendance` (migration: `ALTER PUBLICATION supabase_realtime ADD TABLE …`) so all three dashboards update live.

---

## Deliverables

**1 migration** covering: drop legacy staff overloads, add `member_onboarding_signatures` self-insert policy, patch `tg_push_photo_to_mips` trigger, add realtime publication for attendance tables.

**Edge function edits:**
- `supabase/functions/automation-brain/index.ts` — cold-start retry.
- `supabase/functions/reconcile-mips-pass-records/index.ts` — trainer attendance.

**Frontend edits:**
- `src/lib/errorReporter.ts` — filter opaque `Script error.`.
- `src/components/devices/LiveAccessLog.tsx` — realtime subscription.
