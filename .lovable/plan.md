# Plan: PT Attendance Hardening & Historical Manual Sync

Enhance the PT session logging workflow to ensure integrity while allowing trainers to manually record completed sessions with validation.

## User Review Required

> [!IMPORTANT]
> - Manual session recording will be permitted only for dates within the last 7 days (adjustable).
> - For past-dated sessions, the system will verify if both the trainer AND the member were present in the gym on that specific day (MIPS/biometric check-in) to prevent unauthorized usage.
> - "Present" status for today will still require the member to be currently checked in (as per current enforcement).

## Proposed Changes

### 1. PT Service Logic
- Modify `log_pt_session` RPC (via migration) to accept an optional `p_session_date` parameter.
- Implement logic to verify gym attendance for both parties if the date is in the past.
- Add a safety window (default 7 days) for manual backfilling.

### 2. UI: Mark PT Status Menu
- Add a "Record Past Session" option to `MarkPtStatusMenu.tsx`.
- Include a Date Picker in the confirmation dialog for past sessions.
- Update the descriptive warnings to explain the attendance verification requirement.

### 3. Identity & Dashboards
- Ensure the `trainer_id` is correctly passed from `MyClients.tsx` and `PTSessions.tsx`.
- Update the `sessionStats` query in `MyClients.tsx` to reflect newly logged historical sessions immediately.

## Technical Details

### Database Migration
- Add `p_session_date date DEFAULT CURRENT_DATE` to `public.log_pt_session`.
- Check `member_attendance` and `staff_attendance` for the target `p_session_date`.
- Raise `insufficient_gym_attendance` error if records are missing for either party.

### Frontend
- Use `shadcn/date-picker` inside the `AlertDialog` in `MarkPtStatusMenu.tsx`.
- Update `logPtSession` service wrapper to pass the selected date.
- Invalidate relevant TanStack Query keys (`pt-attendance-history`, `client-session-stats`).
