# PT Auto Attendance v2: duty-hours aware, three modes, trainer corrections with manager approval

## What we found (live data, 9 Oct)
- Gyanesh's roster today is 06:00–10:00 (morning block). He clocked in at 06:21 and out at 09:38. Sweety arrived at 10:18, after his duty ended, so the system correctly didn't mark the session. It also sent a "trainer not in" alert.
- Today's rule pairs a client with their trainer in two cases: they scanned within 30 minutes of each other, or the client arrived during an open shift with no clock-out. Gate scans close shifts early (Gyanesh's shift was closed at 09:38 while he kept scanning until 09:47). So in your example (trainer in from 06:00, client at 11:30) the session can be missed even though the trainer is on duty.
- Correcting a mistake is currently limited to Mark / Dismiss / Undo on the PT Attendance page, for staff only. Trainers can't see or correct anything.

## New pairing rule (based on the duty roster)
A session is marked when the client's arrival falls inside the trainer's **on-duty window** for that day:

```text
on-duty window = trainer clocked in today
                 from: first clock-in that day
                 until: the later of (last gate scan + 30 min) and (rostered shift end + 30 min)
                 but never beyond the real clock-out + 30 min if the trainer clocked out before the shift ended
```

- Trainer in since 06:00 (shift 06:00–14:00), client at 11:30: marked, because the trainer is on duty.
- Client arrives first, trainer clocks in within 30 min: marked. The manager is alerted if the trainer was 10 or more minutes late.
- Client arrives first, trainer clocks in more than 30 min later: goes to Review. The manager is alerted that the trainer was very late.
- Client arrives after the trainer's duty is over (Sweety today): not marked. It goes to Review as "outside trainer duty" and the manager can mark it with one tap.
- No roster for the day: falls back to clock-in/out times, plus the 30-minute rule.
- Dual shifts (morning + evening) are checked block by block, using the same shift matching that staff attendance already uses.

## Three modes per branch (Settings on the PT Attendance card)
- **Automatic**: sessions are marked by themselves, as today.
- **Review first**: nothing is marked by itself. Every match appears as "Ready to confirm" for the trainer or desk to approve with one tap.
- **Manual only**: auto-marking is off and the current Mark Present flow is unchanged.

The 30-minute window, the late-alert minutes and manager alerts stay adjustable. Manual marking keeps working in every mode.

## Trainer dashboard
New **Today's PT attendance** card on the trainer's own dashboard, showing their clients only:
- Each client shows arrival time, trainer duty status and the result (Marked / Ready to confirm / Needs review / Not marked).
- In **Review first** mode the trainer can confirm their own matched sessions directly.
- **Request correction** (opens a side drawer with a required reason):
  - "We trained, please mark it". Use this for a missed session, for example the trainer forgot to scan back in.
  - "Didn't train, please undo". Use this for a wrong auto-mark, for example open-gym only.
- The request goes to the branch manager's approvals and notifications. Nothing changes until the manager approves. Once approved the session is marked or undone, and the trainer is notified of the decision.
- The trainer can see pending, approved and rejected requests.

## Branch manager
- The PT Attendance card adds an "Outside duty" reason and a Pending corrections count.
- Approve or reject happens in the existing Approvals screen, under a new type "PT attendance correction", and also inline on the card.
- Every action records who did it, when, and why.

## Testing
- Re-run today's data. Sweety should land in Review as "outside trainer duty", not as a silent miss. Ananya, Harshil and Bhavesh should stay marked.
- Scenario tests in the database: trainer on 06:00–14:00 with client at 11:30 (marked); client first, trainer +20 min (marked + late alert); trainer +45 min (review); dual shift; no roster; Review-first mode; manual mode.
- Browser checks: as owner (card, settings, approve), and as trainer Gyanesh (sees only his clients, files a correction, can't approve it himself).

## Technical details
- `pt_auto_attendance_evaluate`: replace the interval logic with a duty window built from `staff_attendance` rows for the IST date (`check_in`, `check_out`, `scheduled_start_at`, `scheduled_end_at`) plus the trainer's gate scans in `access_logs`. Add the `outcome` value `ready_to_confirm` and the reason column `match_reason` (`co_arrival`, `on_duty`, `outside_duty`, `trainer_very_late`).
- Config adds `mode` (`auto` | `review` | `manual`), default `auto`. In `review` mode, write `ready_to_confirm` and create no session. In `manual` mode, return early.
- New table `pt_attendance_corrections` (log_id, requested_by, action `mark`|`undo`, reason, status, decided_by, decided_at). Grants plus branch-scoped RLS: trainers read their own, managers read their branch. Add the enum value `approval_type` `pt_attendance_correction` and link via `approval_requests` so the existing approvals UI lists it.
- RPCs, each with `rpc_guard_applies` and an explicit grant:
  - `pt_attendance_request_correction`: trainer, own clients only.
  - `pt_attendance_decide_correction`: manager/owner of the branch. Reuses the mark/reverse logic of `pt_auto_attendance_resolve`.
  - `pt_auto_attendance_resolve`: confirming a `ready_to_confirm` row is allowed for the assigned trainer.
  - `pt_auto_attendance_board`: add a trainer-scoped variant `pt_auto_attendance_my_board`.
- Notifications go to managers (request) and the trainer (decision), using the same in-app path as the current alerts.
- UI files:
  - `src/components/pt/PtAutoAttendancePanel.tsx`: mode selector, outside-duty reason, pending corrections.
  - New `src/components/pt/TrainerPtAttendanceCard.tsx` and `src/components/pt/PtCorrectionRequestDrawer.tsx` (Sheet).
  - Mount the card in `src/pages/TrainerDashboard.tsx` next to `TrainerTodayPanel`.
  - Approval rendering for the new type in the existing approvals list.
- Unchanged: gate triggers (still never block scans), `log_pt_session` manual flow, payroll/commission logic, staff attendance recording.
