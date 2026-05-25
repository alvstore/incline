## Staff Roster v2 — Universal, AM/PM, Bulk Edit, Robust Attendance

Scope is presentation + a small data-fetch widening. No schema changes.

### 1. Universal staff (drop "trainer-only")
- Replace `useStaffSchedules` source from `trainers` table to **`useUnifiedStaff`** (already returns trainers + employees with managers/frontdesk/cleaning).
- Filter to people whose `branch_id === effectiveBranchId` AND `is_active`.
- Rename type `TrainerRosterRow` → `StaffRosterRow` and add `roles: StaffRole[]` + `position` so the UI can show a role chip (Trainer / Manager / Front Desk / Cleaning / Staff).
- Hero title: "Staff Roster" stays, but every "Trainer" label (table headers, badges, empty state, edit drawer copy, PDF) becomes "Staff" / "Team member". Add a **role filter** chipbar (All · Trainers · Managers · Front Desk · Cleaning · Other) at the top of every view.
- Audit string sweep in `StaffRoster.tsx`, `pdfBlob.buildStaffRosterPdf`, `RosterSendDrawer`, send messages, toast copy.

### 2. Edit Shift drawer — "Apply to all days until changed"
Drawer gets a new top section:

```text
┌─ Apply to ─────────────────────────────┐
│  ( ) Only Monday                       │
│  (•) All weekdays (Mon–Sat)            │
│  ( ) Every day (Mon–Sun)               │
│  ( ) Custom… [Mon][Tue][Wed]…          │
└────────────────────────────────────────┘
```

- Default = "Only this day" (preserves current behavior).
- When user picks a multi-day option, save runs a **batched upsert** through `useUpsertShift` over each selected weekday in parallel; one toast at end.
- "All weekdays" honors existing weekly-off rows (skips them unless the user also enables a checkbox "Overwrite weekly-off rows"). Prevents the duplicate-weekly-off index error.
- Validation moves to the bulk path: if Sunday is included AND the staff has weekly_off=Sun, show inline confirm ("This will replace their Sunday off-day with a working shift").

### 3. Sunday-as-duty override (per agreement)
- Sunday is no longer treated as a forced off-day. The system already allows any weekday as weekly_off; the UI gains:
  - In Day view, add a Sunday tab (already present in WEEKDAYS array, keep as-is).
  - In edit drawer, a new helper banner appears only on Sunday: "Sunday is a contractual working day for some staff. Toggle 'Weekly off' OFF and assign normal shifts." with a quick "Assign standard 6h shift" button (06:00–12:00).
  - Week view: Sunday column gets a subtle "contracted" badge when any staff is working that day.
- No DB change required (`is_weekly_off` is per row/weekday).

### 4. 12-hour AM/PM display everywhere on Staff Roster
- Add a `fmtTime12(t)` helper (e.g., `06:00` → `6:00 AM`, `17:30` → `5:30 PM`). Inputs in the edit drawer remain native `type="time"` (browser localizes the picker chrome) — only **display** changes.
- Replace every `fmtTime(s.morning_start)` render in `ShiftPill`, `DayView`, `WeekView`, `MonthView` tooltip text, attendance check-in/out columns (already use `hh:mm a` — good), and **`buildStaffRosterPdf`** table cells/legend.

### 5. PDF download = weekly by default
- Hero "Export PDF" button always exports the **current week** (scope `week`), regardless of which tab is open.
- A small dropdown next to it offers: "This week (default)" · "Today" · "This month" · "Attendance log".
- `buildStaffRosterPdf` already supports `scope: week`; we just change the default invocation. Update filename: `roster-{branch}-week-{YYYY-MM-DD}.pdf`.
- All PDF labels switched to AM/PM + "Staff" wording.

### 6. Attendance log — robust monthly view
Replace the current flat list with a **summary + drill-down matrix**:

**Top KPI strip** (4 cards): Total staff · On-time % · Late arrivals · Absences (scheduled − present).

**Per-staff monthly matrix** (table, sticky first column):

```text
Name          | 1 | 2 | 3 | ... | 31 | Present | Late | Absent | Off | Hours
Ritesh Sharma | ✓ | ✓ | L | ... | ✗  |   22    |  3   |   2    |  4  | 176h
```

Cell legend:
- ✓ green — on time (check_in ≤ shift_start + 10 min grace)
- L amber — late (check_in > grace; tooltip shows minutes late)
- ✗ red — absent (scheduled but no check_in, and not weekly-off)
- — blue — weekly off
- · gray — not scheduled / future date

**Late detection** joins the attendance log against the staff's `staff_shifts` row for that weekday (`morning_start` is the reference; if only evening shift, use that). 10-minute grace is configurable later; ships as a constant.

**Filters**: month picker · role filter · "Show only late" toggle · search by name.

**Drill-down**: clicking any cell opens a side sheet with that day's check-in/out times, total hours, and a "Mark present" / "Add manual entry" action (wired to existing `staffAttendanceService`).

**Export**: "Export attendance PDF" reuses `buildStaffRosterPdf({ scope: 'month' })` extended with an `attendanceMatrix` mode that prints the same grid in landscape A4 with branded header.

### 7. Notifications (already in flight — no change in this loop)
Lateness email/WhatsApp notifications are out of scope here; this loop only surfaces lateness in UI/PDF. We'll wire the existing `staffAttendanceNotify` dispatcher to the late-detection logic in a follow-up if you want.

---

### Technical notes (for devs)

- New hook: `useStaffRoster(branchId)` — wraps `useUnifiedStaff` + the existing `staff_shifts` fetch, keyed by `['staff-roster', branchId]`. Old `useStaffSchedules` removed.
- `useUpsertShift` gains `mutateAsync` use inside a `useBulkUpsertShifts({ user_id, weekdays[], payload })` helper for the bulk-apply path.
- `pdfBlob.ts`: extract `formatTime12()` shared with the page; add an `attendanceMatrix` rendering branch to `buildStaffRosterPdf`.
- New components: `RosterRoleFilter.tsx`, `AttendanceMatrix.tsx`, `AttendanceDayDrawer.tsx`, `ApplyToDaysControl.tsx`.
- Files touched: `src/pages/StaffRoster.tsx`, `src/hooks/useStaffSchedules.ts` (rename/expand), `src/utils/pdfBlob.ts`, plus the four new components above.

### Out of scope
- Schema migrations.
- Lateness push/WhatsApp notification wiring (separate loop).
- MIPS auto check-in.

Skills used: `/skill:ui-ux-pro-max`, `/skill:redesign`, `/skill:senior-frontend`.