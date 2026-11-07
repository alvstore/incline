# Flutter app: role-based routing for Owner/Admin, Manager, Staff, Trainer (and Member)

## Goal
Turn the existing Flutter guide (today member-only, it tells staff to "use the web app") into ONE app with role-based routers, so the Flutter team can start building staff-side screens. Everything stays in the same single guide file — no new docs.

## What changes

### 1. One app, one login, role router
- Login stays the same (email or +91 mobile, set-password gate).
- After login the app loads one "app context" (roles, branch(es), capabilities, flags) and picks a home shell — mirroring the web's home-page rule:
  - Member → Member shell (current guide, unchanged)
  - Trainer (no manager/admin role) → Trainer shell
  - Staff (no manager/admin role) → Front-desk shell
  - Manager → Manager shell (single branch)
  - Owner/Admin → Admin shell (branch switcher + "All branches")
- Member role is exclusive, same as web. Unknown/no role → "Account not set up, contact front desk".

### 2. Screens per role (first build, phone-friendly only)
- **Trainer:** today's PT clients & sessions, mark/log PT attendance (fallback to automatic attendance), my clients list, assign workout/diet plan, client progress + treadmill runs, my classes, my payout summary (own only).
- **Staff / Front desk:** member search + profile, check-in & today's attendance, record payment (cash/UPI/card via the existing payment function), facility/class bookings, leads & follow-up tasks, approvals filing (freeze etc. go to manager), lockers view.
- **Manager:** everything staff has + branch dashboard (revenue, dues, renewals), approvals inbox, renewal center queue, staff attendance view, discounts within limit.
- **Owner/Admin:** manager screens + branch switcher, cross-branch summary, read-only system health. Settings, payroll, devices, automations stay **web-only** in phase 1.

### 3. Permission rules for the app
- Every button is shown from the same capability list the web uses (view financials, record payment, approve discount, freeze/cancel membership, manage renewals, etc.). Financial screens hidden for staff and trainer.
- The server remains the real gate: the app never assumes it is allowed — it handles "not allowed" replies with a clean message.
- Branch: staff/trainer/manager are locked to their branch; owner/admin switch branch and the app calls the same "set active branch" step the web uses.

### 4. Notifications per role
Same single In-App path (bell + phone pop-up through the existing push function). Taps route to the right shell's screen (e.g. trainer → PT session, manager → approval).

### 5. Feature flags
A per-role on/off switch for each staff module (e.g. `flutter_staff_payments_enabled`), read from existing settings, default OFF so modules can be released one at a time without an app update.

### 6. Roadmap update
Add staff-app phases after member phases: S0 role router + shells → S1 Trainer → S2 Front desk → S3 Manager → S4 Owner/Admin read-only → S5 hardening.

## Technical details
- Edit only `docs/flutter-member-app-readme.md` (retitle to "Incline App (Flutter)"): replace §4 role gate, add §21 "Role router & shells" (go_router redirect logic, Dart `AppRole`/capability enum mirroring `src/lib/auth/permissions.ts` and `getHomePath`), §22 per-role data-access maps listing the existing tables/RPCs each screen uses (`record_payment`, `log_pt_session`, `freeze_membership` via approvals, `renewal_center_queue`, `set_active_branch`, `has_capability`), extend §3 structure with `features/staff|trainer|manager|admin/`, extend §7 flags and §18 roadmap. Also update `docs/README.md` index line and the Flutter rule in `AGENTS.md`.
- Before writing, verify each referenced RPC/table and its role guard in the live database; anything missing or member-only is marked "not available yet (web-only)" instead of invented.
- Optional backend item (only if no equivalent exists): one read-only `my_app_context()` function returning roles, branch ids and capabilities for the signed-in user, granted to signed-in users, with a small test. No other database changes.
- No Flutter code is written in this repo; no real messages sent.
