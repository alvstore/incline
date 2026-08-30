# MIPS Personnel Routing Fix — Staff/Trainers in "Visitor", Missing Owners, Attendance Module

## What the live server actually says (verified, not assumed)

I logged into the MIPS server read-only and checked the records.

| Check | Result |
|---|---|
| Trainer Puneet Meghwal (`TRNE5C9`) | `personType: 2`, `deptId: 102`, `deptName: "Member"` |
| Member Pushpa Meena (`INC260137`) | `personType: 1`, `deptId: 100`, `deptName: "Incline"` |
| Departments that exist on the server | only `100 Incline` (142 people) and `103 Visitors` (0 people) |
| Rajat Lekhari (`EMPINC0003`) | **does not exist on MIPS** — 0 rows |
| Yogita Lekhari (`EMPINC0004`) | **does not exist on MIPS** — 0 rows |
| Both gates | App Version **V3** already, device firmware 1.42.0.2 |

### Root cause 1 — staff and trainers are pushed as visitors
`sync-to-mips` sets `personType = person_type === "member" ? 1 : 2`. On this RuoYi/Smart-Pass build, `personType 1` = personnel and `personType 2` = visitor. So every employee and trainer we sync is created as a visitor, which is exactly why they show under `#/visitor/visitor` with a `2099-12-31` end date. Our own API reference document even says `personType` should always be `1` — the code drifted from the spec.

### Root cause 2 — we send department IDs that don't exist
The code sends `deptId 101` for employees and `102` for trainers. The server only has departments `100` and `103`, so those people land in a phantom department (which is why the trainer row reads `deptName: "Member"`).

### Root cause 3 — Rajat and Yogita were never created
Both employee rows are active, have a biometric photo, and sit on the main branch, but their `mips_sync_status` is `failed` with **zero** rows in `mips_sync_attempts` and zero in `mips_sync_failures`. They were never actually dispatched; nothing retries a `failed` status, so they stay invisible forever.

### On the V1/V3 restart theory
Both gates are already configured as **V3** in the MIPS device page, and our code never sets `appVersion` — we cannot cause a V1/V3 mismatch. The restart-after-sync behaviour is device firmware reacting to `syncPerson`, and the volume of those syncs was already cut in the previous fix (drift-only reconciliation, quiet hours). No further version work is warranted.

### On Smart Attendance
The server does expose attendance (`attnShiftId`, `inLate`, `outEarly`, `/interface/exterior/getCheckRecordList`), and we already send `attendance: "1"` so punches are recorded. We deliberately do **not** use the MIPS attendance module for shifts/payroll: the CRM roster engine (`resolve_staff_shift`, dual shifts, overrides, grace, overnight) is the source of truth and MIPS shift tables cannot express it. Recommendation: keep CRM authoritative, keep MIPS as a punch source only. No change.

## The fix

1. **Person type** — always send `personType: 1` for members, employees and trainers. Visitors stay a manual, MIPS-side concept.
2. **Department** — resolve the department from the server's real list instead of hard-coding. Use `100 Incline` as the single department (matching how members are already stored), keeping `deptName` descriptive per role. Optionally create real `Staff`/`Trainers` sub-departments under `100` later; not required for correct routing.
3. **Migrate the 8 existing mis-typed people** — for every employee/trainer already on MIPS (`TRN7059`, `TRNBDF1`, `TRN641B`, `TRNBC0C`, `TRN3E85`, `TRNE5C9`, `TRNA893`, `EMPMOZWZUNA`), do a full-object `PUT /personInfo/person` with `personType 1` and the correct `deptId`, then one `syncPerson` dispatch per person so the gates pick up the change. They keep the same `personId`, so face templates, access logs and attendance history are untouched.
4. **Create Rajat and Yogita** — run the corrected sync for both employee records and confirm they appear under Personnel with a photo on both gates.
5. **Stop silent failures** — when a sync ends in `failed`, write a row to `mips_sync_failures` with the reason, so a person can never go missing without a trace, and surface them in the Device Command Center as "Never synced".

## Technical scope

- `supabase/functions/sync-to-mips/index.ts` — `personType` constant, department resolution, failure logging.
- One-off migration invocation of the corrected function for the 8 existing + 2 missing people (no schema change).
- `.lovable/mips-api-reference.md` — correct the dept table (`101`/`102` don't exist).
- Verification: re-query `/personInfo/person/list` for each person and assert `personType 1` + valid `deptId`, and confirm the Visitor page is empty.

No changes to attendance logic, roster, payroll, access gating, or the reconciliation/face-sweep behaviour fixed earlier.
