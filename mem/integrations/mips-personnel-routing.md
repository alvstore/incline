---
name: MIPS personnel routing (personType / deptId)
description: Every person synced to MIPS must be personType 1 with deptId 100; personType 2 is Visitor Management.
type: constraint
---
# MIPS personnel routing

- `personType: 1` = Personnel, `personType: 2` = **Visitor**. `sync-to-mips` must always send `1` for members, employees and trainers. Sending `2` for staff/trainers is what put them on the vendor `#/visitor/visitor` page (fixed in `sync-to-mips` v2.7.0).
- The MIPS server only has departments `100 Incline` and `103 Visitors`. `deptId 101` (staff) and `102` (trainers) do **not** exist — never send them. All CRM-synced people use `STAFF_DEPT_ID = 100` with a role-descriptive `deptName`/`remark`.
- Owners Rajat (`personId 133`) and Yogita (`personId 134`) existed as manual `ADMIN`/`Admin2` records; they were renamed to `EMPINC0003`/`EMPINC0004` and adopted by the CRM (same personId, face templates preserved).
- Smart Attendance on MIPS is deliberately unused: we send `attendance: "1"` so punches are captured, but shifts/lateness/payroll stay in the CRM roster engine (`resolve_staff_shift`). Do not migrate shifts to `attnShiftId`.
- Any sync ending in `mips_sync_status='failed'` must also write a `mips_sync_failures` row — a silent failure is how two owners stayed missing from the gates.
