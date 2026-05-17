# Consolidate all attendance into one screen

## Why
- **Sidebar "Staff Attendance"** (owner/admin/manager) currently points to `/staff-attendance`, which in `App.tsx` is just a `<Navigate to="/attendance-dashboard" />`. It's a dead duplicate of the "Attendance" entry already in the sidebar — pure noise.
- **"PT Attendance"** lives on its own page `/pt-attendance` and gets its own sidebar entry for trainers, staff, managers, owners, admins. Splitting member/staff attendance from PT attendance forces users to bounce between two screens. Merging it into the existing `AttendanceDashboard` tabs gives one control room, and lets reception staff mark PT attendance on a trainer's behalf without leaving the page.

## What changes

### 1. Sidebar (`src/config/menu.ts`)
Remove these redundant entries (5 lines total):
- `Staff Attendance → /staff-attendance` for owner/admin/manager (line 233)
- `Staff Attendance → /staff-attendance` for manager (line 307)
- `PT Attendance → /pt-attendance` for trainer (line 78)
- `PT Attendance → /pt-attendance` for staff (line 128)
- `PT Attendance → /pt-attendance` for owner/admin/manager (line 191)
- `PT Attendance → /pt-attendance` for manager (line 268)

Keep the single `Attendance → /attendance-dashboard` entry that every role already has.

### 2. Routes (`src/App.tsx`)
- Keep `/staff-attendance → /attendance-dashboard` redirect (for old bookmarks).
- Add `/pt-attendance → /attendance-dashboard?tab=pt` redirect (replaces the standalone page route). The `PtAttendance` lazy import can stay for one release as a safety net, or be removed — recommend removing.

### 3. `AttendanceDashboard.tsx` — add a "PT Sessions" tab
- Add a 5th `TabsTrigger value="pt"` next to Members / Staff Check-in / Staff Log / History, gated by capability: visible to owner, admin, manager, staff, and trainer.
- Read `?tab=pt` from the URL on mount so the redirect lands on the right tab.
- Tab body renders the existing PT attendance UI extracted from `src/pages/PtAttendance.tsx` (today's sessions list, mark present/absent/late/no-show actions, trainer filter for managers, member search). No business-logic changes — same `ptService` calls, same RPCs, same RLS.
- **Trainer scope:** when the logged-in user is a trainer, the tab auto-filters to their own sessions (current `PtAttendance` behaviour). When the user is staff/manager/owner/admin, they see all trainers' sessions with a trainer filter and can mark status on behalf of any trainer — this is the new capability the user asked for. Backed by the existing `markPtSessionStatus` mutation; the RPC already accepts any authorized caller, so no DB change required.

### 4. Cleanup
- Delete `src/pages/PtAttendance.tsx` after the tab is wired up.
- Delete `src/pages/StaffAttendance.tsx` if it exists and is unused (the route already redirects).

## Out of scope
- No changes to PT attendance business logic, RPCs, RLS, or `markPtSessionStatus` permissions.
- No changes to the Members or Staff tabs already in the dashboard.
- No styling overhaul — the new tab uses the same Vuexy card/table patterns already on the page.

## Files touched
- `src/config/menu.ts` — remove 6 entries
- `src/App.tsx` — swap `/pt-attendance` route to a redirect, drop lazy import
- `src/pages/AttendanceDashboard.tsx` — add PT tab + URL-param tab sync
- `src/pages/PtAttendance.tsx` — delete (logic moves into the tab)
- `src/pages/StaffAttendance.tsx` — delete if present
