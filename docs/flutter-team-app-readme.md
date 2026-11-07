# Incline Team App (Flutter) — Staff, Trainer, Manager, Owner/Admin

Separate native app for the **Incline team**. Members use the **Incline Member app** (`flutter-member-app-readme.md`). Both apps talk to the **same backend** — every rule (permissions, branch scope, prices, dues, approvals) is enforced by the database and backend functions. The app only displays data and calls approved actions.

> **Status:** guide + roadmap for the Flutter team. No Flutter code lives in this repository. Every server function named below was checked against the live database on 7 Nov 2026; anything not listed is **web-only for now**.

## Contents
1. Golden rules · 2. App setup · 3. Sign-in & role gate · 4. Role router · 5. Capabilities · 6. Branch rules · 7. Feature map (web → app) · 8. Data-access map · 9. Release switches · 10. Notifications · 11. Errors & UX · 12. Testing · 13. Roadmap

---

## 1. Golden rules
1. Public (anon) key only. Never ship service-role keys, provider tokens or `x-internal-token`.
2. All multi-step writes go through existing server functions (`record_payment`, `create_pos_sale_audited`, `freeze_membership`, `cancel_membership`, `process_approval_request`, locker/attendance RPCs). No client sequences.
3. Never trust role, `branch_id` or `member_id` from local storage — always from the session + server.
4. Hide buttons using capabilities; the **server is the real gate**. Handle `42501` / `success:false` gracefully.
5. Errors go through `rpc('log_error_event', …)` (same as member app). Pass `null`, never `''`, for auto-generated fields.
6. Outbound member messages: never insert into `communication_logs` or call `send-*` functions — use backend flows that call `dispatch-communication`.
7. Sensitive files (ID, medical, contracts) only via short-lived signed URLs (60 s).
8. Financial numbers only for roles with `view_financials`.

## 2. App setup
| Item | Value |
|---|---|
| App name | Incline Team |
| Bundle IDs | separate from member app (e.g. `in.theincline.team`) |
| Deep-link scheme | `inclineteam://` (+ `https://theincline.in/team/*` universal links) |
| Stack | Flutter 3, Riverpod, go_router, supabase_flutter, freezed, intl (IST), firebase_messaging |
| Layouts | phone + tablet (front desk iPad). Forms open as bottom/side sheets, never centre dialogs |

Structure:
```text
lib/
  app/        router, theme, env, app_context
  core/       supabase, IST dates, INR money, error mapper, capabilities, flags
  features/
    auth/ home/ members/ attendance/ payments/ store/ bookings/ classes/
    pt/ plans/ progress/ leads/ tasks/ renewals/ lockers/ approvals/
    memberships/ expenses/ staff_attendance/ dashboards/ notifications/ profile/
  shells/     trainer_shell, desk_shell, manager_shell, admin_shell
```

## 3. Sign-in & role gate
- Login with email or +91 mobile (resolve via `resolve-login-identifier`, then `signInWithPassword`), same as web. `must_set_password` forces the set-password screen first.
- After login read `user_roles` for `auth.uid()`.
- **Member-only accounts are refused**: show "This app is for the Incline team. Please use the Incline Member app." and sign out.
- No roles → "Account not set up — contact your manager".
- Re-read roles on app resume and auth change (role removed → sign out).

## 4. Role router (mirrors web `getHomePath`)
```dart
enum TeamRole { owner, admin, manager, staff, trainer }

String homeFor(Set<TeamRole> r) {
  if (r.isEmpty) return '/refused';
  final top = r.contains(TeamRole.owner) || r.contains(TeamRole.admin);
  if (top) return '/admin';
  if (r.contains(TeamRole.manager)) return '/mgr';
  if (r.contains(TeamRole.trainer) && !r.contains(TeamRole.staff)) return '/t';
  return '/desk';                     // staff (and staff+trainer)
}
```
One go_router `redirect`: no session → `/login`; `must_set_password` → `/set-password`; path outside the user's shell → `homeFor(roles)`.

## 5. Capabilities (mirror `src/lib/auth/permissions.ts`)
| Capability | Roles |
|---|---|
| view_financials | owner, admin, manager |
| record_payment, manage_renewals | owner, admin, manager, staff |
| approve_discount, cancel_membership, cancel_invoice, freeze_membership, credit_member, delete_task, manage_class_schedule, manage_devices | owner, admin, manager |
| cross_branch_view, manage_settings, manage_staff, manage_automations, view_reconciliation | owner, admin |
| book_facility | all |

Server check: `rpc('has_capability', …)` + RLS + function guards.

## 6. Branch rules
- Staff / trainer / manager: locked to their branch (`get_user_branch`, managers `managed_branch_ids`). No switcher.
- Owner / admin: branch switcher + "All branches" summary. On change call `rpc('set_active_branch', {p_branch_id})`, then refetch. Still filter by `branch_id` (defense-in-depth).

## 7. Feature map (web → app)
| Web feature | Trainer | Staff | Manager | Owner/Admin | Phase |
|---|---|---|---|---|---|
| Home dashboard (today) | own day | desk day | branch KPIs | all branches | T0/T4/T5 |
| Member search & profile | own clients | yes | yes | yes | T1 |
| Check-in / today's attendance | — | yes | yes | yes | T1 |
| Facility & class bookings | classes view | yes | yes | yes | T1 |
| Tasks & follow-ups | own | yes | yes | yes | T1 |
| Leads follow-up | — | yes | yes | yes | T1 |
| Notifications inbox | yes | yes | yes | yes | T0 |
| Collect payment / dues | — | yes* | yes | yes | T2 |
| Store checkout (POS) | — | yes* | yes | yes | T2 |
| Lockers assign/release | — | yes | yes | yes | T2 |
| PT clients & sessions | yes | view | yes | yes | T3 |
| Workout/diet plans | yes | — | view | view | T3 |
| Client progress / measurements | yes | — | view | view | T3 |
| Own attendance (staff check-in) | yes | yes | yes | — | T3 |
| Approvals inbox | — | file request | yes | yes | T4 |
| Freeze / cancel membership | — | request | yes | yes | T4 |
| Expenses | — | — | yes | yes | T4 |
| Staff attendance (team) | — | — | yes | yes | T4 |
| Renewal Center queue | — | yes | yes | yes | T5 |
| Revenue analytics | — | — | yes | yes | T4/T5 |
| Cross-branch summary, audit | — | — | — | yes | T5 |

\* behind `flutter_team_payments_enabled`.

**Web only (for now):** settings, integrations, templates, devices/MIPS, Automation Brain, campaigns composer, payroll processing, HR contracts, standby copy, AI agent setup, reconciliation fixes.

## 8. Data-access map (verified live)
### Front desk
- Search: `members` (branch-scoped), `memberships`, `invoices`.
- Today's check-ins: `rpc('get_todays_checkins', {_branch_id})`; consolidate per member per IST day.
- Check-in: `rpc('validate_member_checkin', {_member_id, _branch_id})` → `rpc('member_check_in', {_member_id, _branch_id, _method, _at})`. Manager override: `rpc('member_force_check_in', {p_member_id, p_branch_id, p_reason, p_actor_user_id})`.
- Payment: `rpc('record_payment', {p_branch_id, p_invoice_id, p_member_id, p_amount, p_payment_method, p_payment_date, p_transaction_id, p_notes, p_received_by, p_income_category_id})` with a stable idempotent `p_transaction_id`.
- Store: `rpc('create_pos_sale_audited', {…, p_idempotency_key})` (list only `is_sellable` products).
- Bookings: `rpc('book_facility_slot', {p_slot_id, p_member_id, p_membership_id, p_source:'staff', p_staff_id, p_force:false})`, `rpc('book_class', {_class_id, _member_id})`.
- Lockers: `rpc('assign_locker_with_billing', …)`, `rpc('release_locker', {p_assignment_id, p_release_date})`, `rpc('approve_locker_request', …)` (manager).
- Tasks/leads: `tasks`, `leads` (branch-scoped); search `rpc('search_command_tasks', …)`.
- Renewals: `rpc('renewal_center_queue', {_branch_id, _queue, _search, _limit, _offset})`.

### Trainer
- Clients/sessions: `member_pt_packages`, `pt_sessions` (RLS limits to own clients). Auto-attendance `pt_auto_attendance_log` is read-only.
- Fallback mark: `rpc('log_pt_session', {p_member_pt_package_id, p_trainer_id, p_status, p_notes, p_session_id, p_session_date})`.
- Plans: `fitness_plan_templates`, `member_fitness_plans` (exercise video fields as in member guide §15). Assigning plans: direct insert allowed by RLS for trainers — mirror web `AssignPlanDrawer` fields.
- Progress: `member_measurements`, `treadmill_workouts`.
- Own attendance: `rpc('staff_check_in', {p_user_id, p_branch_id, p_source, p_notes})`.

### Manager
- Approvals: `approval_requests` → `rpc('process_approval_request', {p_request_id, p_decision, p_review_notes})`.
- Freeze: `rpc('freeze_membership', {p_membership_id, p_freeze_days, p_reason})`. Cancel: `rpc('cancel_membership', {p_membership_id, p_reason, p_refund_amount, p_refund_method, p_idempotency_key})`.
- Expenses: `rpc('record_expense', …)`, `rpc('edit_expense', …)`.
- Analytics: `rpc('analytics_revenue_series', {p_branch, p_from, p_to, p_grain})`, `rpc('analytics_revenue_by_plan', …)`, `rpc('analytics_session_duration_daily', {p_branch, p_days})`.
- Team attendance: `staff_attendance` (read).

### Owner/Admin
Everything above + branch switcher, cross-branch summaries (pass `p_branch = null` where supported), `audit_logs` read-only.

**Not built yet (do not code against):** a single "app context" RPC, a dedicated team-dashboard summary RPC. Read `user_roles` + the helpers above instead.

## 9. Release switches
Keys in `settings` (branch row first, then global), **default OFF**, fail closed:
`flutter_team_app_enabled`, `flutter_team_desk_enabled`, `flutter_team_payments_enabled`, `flutter_team_trainer_enabled`, `flutter_team_manager_enabled`, `flutter_team_admin_enabled`. Off → "Use the web dashboard for now". These keys are not created yet — add them when T0 starts.

## 10. Notifications
Same pipeline as web: rows in `notifications` → push to all devices. Store the device token with app id `team` so member and team pushes never mix. Taps route `data.url` through the router; outside the user's shell → home + inbox item. No personal, financial or health data on the lock screen.

## 11. Errors & UX
Skeletons while loading, empty states with an action, "You don't have permission for this" on `42501`, never auto-retry money actions, disable submit while saving, INR with GST shown as on web, IST dates everywhere.

## 12. Testing
Role-matrix integration tests (each role × each route → allowed/redirected), member-account refusal, branch switch refetch, idempotent payment retry, offline banners.

## 13. Roadmap
- [ ] **T0 Foundation** — app shell, login, member refusal, role router, branch switcher, flags, notifications inbox + push.
- [ ] **T1 Front desk** — member search/profile, check-in + today's list, bookings, tasks, leads.
- [ ] **T2 Money** — collect payment, dues, store checkout, lockers (behind payments switch).
- [ ] **T3 Trainer** — PT clients, sessions, plans, progress, own check-in.
- [ ] **T4 Manager** — approvals, freeze/cancel, expenses, team attendance, branch analytics.
- [ ] **T5 Owner/Admin** — cross-branch dashboards, renewal center, audit view.
- [ ] **T6 Polish** — tablet desk layout, offline-friendly check-in queue, analytics, store release.
