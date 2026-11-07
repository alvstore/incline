# Two Flutter apps: Incline Member + Incline Team

## Goal
Split the single "all roles" Flutter guide into two separate apps that share the same backend:

```text
Incline (Member app)        Incline Team (Staff app)
- members only              - owner / admin / manager / trainer / staff
- existing guide            - new guide + full roadmap
- blocks staff logins       - blocks member-only logins
```

## What changes

### 1. Member guide goes back to member-only
- Remove the staff/trainer/manager/admin router, shells and roadmap sections added last time.
- Keep a short note: "Staff accounts sign in to the Incline Team app."
- Member sign-in rule: if the account has no member role, show "Please use the Incline Team app".

### 2. New guide: Incline Team app (single app, role-based)
One app, one login; the home screen and menu change by role (same rules as the web dashboard).

Contents:
- **Setup**: separate app name and store listing, same backend, same sign-in (phone OTP / email), session handling, push notifications.
- **Role router**: owner/admin, manager, trainer, staff each get their own home and menu; member-only accounts are refused.
- **Branch rules**: staff, trainer and manager locked to their branch; owner/admin switch branch (mirrors web).
- **Permission rules**: buttons hidden by the same capability list as web; the server always has the final say; refusals show a friendly "no permission" message.
- **Feature map** — every web feature listed per role as *In app (phase X)* or *Web only*:
  - Trainer: today's PT clients, mark sessions, client progress/measurements, assign diet/workout plans, classes, own attendance, own payroll view.
  - Staff (front desk): member search/profile, check-in & attendance, collect payment, store checkout, facility & class bookings, tasks, leads follow-up, renewal queue, lockers, notifications.
  - Manager: everything staff has + approvals, freeze/cancel, branch dashboard (revenue, attendance, renewals), staff attendance, expenses, feedback.
  - Owner/Admin: everything manager has + branch switcher, cross-branch dashboards, audit view.
  - Web only (for now): settings, integrations, devices, automations, campaigns composer, payroll processing, HR contracts, standby copy.
- **Data map**: for each screen, the existing server action it uses (only ones verified live).
- **Release switches**: each section can be turned on/off per role, default off.
- **Roadmap** (phased):
  - T0 Foundation: login, role router, branch switcher, notifications.
  - T1 Front desk: search, check-in, bookings, tasks.
  - T2 Money: payments, store checkout, dues (manager/owner + permitted staff).
  - T3 Trainer: PT sessions, clients, plans, progress.
  - T4 Manager: approvals, freeze/cancel, dashboards, staff attendance, expenses.
  - T5 Owner/Admin: cross-branch dashboards, audit, renewal center.
  - T6 Polish: offline-friendly check-in, tablet layout, analytics.

### 3. Index and rules
- Update the docs index with both guides.
- Update the project rule: "Two Flutter apps share one backend: member app and team app; each refuses the other's roles."

## Technical details
- Files: trim `docs/flutter-member-app-readme.md` (§21–23 and role-gate line); create `docs/flutter-team-app-readme.md`; update `docs/README.md` and root `AGENTS.md`.
- Re-verify every listed server function against the live database before documenting; anything missing is marked "not built yet".
- No app code, database, or backend changes.
