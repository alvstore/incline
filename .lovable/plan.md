
## Audit findings

**What works today**
- `log_pt_session` RPC is atomic, role-gated (owner/admin/manager/trainer), and idempotently creates a gym check-in in `member_attendance` when a PT session is logged.
- `pt_sessions` RLS already allows trainer (own sessions) + member (own packages) + staff (any) to read.
- Member already has `/my-attendance` (gym check-ins) and `/my-pt-sessions` (PT history) pages.

**Gaps vs. the request**
1. `log_pt_session` always writes `status='completed'`. No way for trainer to mark **absent / holiday / late**. `pt_session_status` enum has only `scheduled, completed, cancelled, no_show, rescheduled` — missing `absent`, `holiday`, `late`.
2. `TrainerTodayPanel` + inline "Mark Attended" button in `MyClients` are single-action ("completed" only). No status picker, no "Holiday" (facility/trainer off-day, should NOT decrement sessions or create check-in), no "Absent" (should decrement for session-based packs but NOT create gym check-in).
3. Trainer can't see "my own staff attendance" alongside their PT activity in one place — split across `/staff-attendance` and `/my-clients`.
4. `/my-pt-sessions` route currently **redirects to `/my-classes?tab=appointments`** — the PT history page exists but is unreachable from nav. Sidebar link is broken.
5. Member portal shows "My Attendance" and "PT Sessions" links to all members regardless of whether they own a PT package. Per request, PT UI should only appear when the member has (or had) a PT package.
6. No unified "PT attendance roster" view for staff/manager/admin/owner — only TrainerDashboard surfaces today's PT marks.

## Plan

### 1. Database — extend status vocabulary & RPC

Migration `extend_pt_session_status_and_log`:
- `ALTER TYPE pt_session_status ADD VALUE IF NOT EXISTS 'absent';`
- `ALTER TYPE pt_session_status ADD VALUE IF NOT EXISTS 'holiday';`
- `ALTER TYPE pt_session_status ADD VALUE IF NOT EXISTS 'late';`
- Replace `log_pt_session(p_member_pt_package_id, p_trainer_id, p_notes)` with overload `log_pt_session(p_member_pt_package_id, p_trainer_id, p_status pt_session_status DEFAULT 'completed', p_notes DEFAULT NULL)`:
  - `present` / `completed` / `late` → record session, decrement counter (session_based), create gym check-in if missing.
  - `absent` → record session, decrement counter (session_based, configurable later), do **NOT** create gym check-in.
  - `holiday` → record session with status='holiday', do **NOT** decrement counter, do **NOT** create check-in. Used for trainer day-off or member-pre-informed leave (the slot is logged for visibility but doesn't consume the pack).
  - Authz unchanged (owner/admin/manager/trainer).
  - Keep `pt_session_logged` comm dispatch only when status is `completed` or `late`.
- Add partial unique index `uniq_pt_session_per_pack_per_day` on `(member_pt_package_id, (scheduled_at::date))` to prevent accidental double-mark.

### 2. Trainer UI — status picker

`src/components/pt/TrainerTodayPanel.tsx`:
- Replace single "Mark Attended" button with split / popover offering 4 actions:
  - **Present** (default, green) → log `completed`
  - **Late** (amber) → log `late`
  - **Absent** (red) → log `absent`
  - **Holiday** (slate) → log `holiday`
- Single AlertDialog with status + optional notes; passes status into `logPtSession`.

`src/services/ptService.ts` → extend `logPtSession({ memberPackageId, trainerId, notes, status })` signature; default `status='completed'`.

`src/pages/MyClients.tsx` inline buttons → same status menu (compact dropdown).

### 3. Staff/manager/admin viewer — PT attendance roster

New page `src/pages/PtAttendance.tsx` (route `/pt-attendance`, roles owner/admin/manager/staff/trainer):
- Date range filter, branch filter (existing context), trainer filter, member search.
- Table: Date · Member · Trainer · Package · Status badge · Notes.
- Status badges: Present=emerald, Late=amber, Absent=red, Holiday=blue, Cancelled=slate, No-show=red-muted.
- CSV export.
- Add menu entry in `src/config/menu.ts` (roles: owner/admin/manager/staff/trainer). Trainer sees own rows (already RLS-restricted).

### 4. Member portal — gate PT UI on package ownership

`src/config/menu.ts` + sidebar render:
- Drop the static `roles: ['member']` gate on "PT Sessions" menu item; instead add a `visibleWhen` predicate `hasAnyPtPackage` resolved via `useMemberData().ptPackages.length > 0`. The sidebar component already has access to member data via context — extend the menu schema to accept an optional `requires` flag `'has_pt_package'` and filter at render time.
- If the member has zero PT packages (active or historical), hide:
  - "PT Sessions" nav item
  - "PT Sessions" tab inside `/my-attendance` (new — see below)
- Restore `/my-pt-sessions` route to render `MyPTSessions` (remove the redirect in `src/App.tsx`).

`src/pages/MyAttendance.tsx`:
- Add a **Tabs**: "Gym Visits" (current view) | "PT Sessions" (only rendered when member has any PT package).
- "PT Sessions" tab shows a chronological list of `pt_sessions` for the member with status badge (Present/Absent/Holiday/Late/Cancelled) and trainer name. Reuses existing query patterns from `MyPTSessions`.

`src/pages/MyPTSessions.tsx`: add a "Attendance" sub-tab beside Upcoming/Completed/All that mirrors the same PT-attendance list with status badges. Keeps single source of truth (`pt_sessions` table).

### 5. Sync & dedup checks
- `log_pt_session` is the only writer to `pt_sessions` from product code — confirmed via grep. Both TrainerTodayPanel and MyClients call it.
- Gym check-in idempotency: existing `EXISTS` guard + new partial unique index on `(member_id, check_in::date) where check_in_method='pt_session'` prevents double rows when trainer marks multiple PT sessions per day.
- Realtime: extend `useRealtimeInvalidate` subscriptions on `MyAttendance` and `MyPTSessions` for `pt_sessions` + `member_attendance` (member-id scoped). Trainer dashboard already invalidates.

### 6. RBAC matrix (final)

| Action | Owner | Admin | Manager | Staff | Trainer | Member |
|---|---|---|---|---|---|---|
| Mark PT status | ✓ | ✓ | ✓ | — | ✓ (own) | — |
| View PT attendance roster | ✓ (all branches) | ✓ | ✓ (branch) | ✓ (branch, read-only) | ✓ (own clients) | — |
| View own gym + PT attendance | — | — | — | — | — | ✓ |
| See PT nav items | — | — | — | — | — | only if has PT package |

### 7. Files

**New**
- `supabase/migrations/<ts>_extend_pt_session_status.sql` — enum values, RPC overload, dedup indexes
- `src/pages/PtAttendance.tsx` — staff roster
- `src/components/pt/PtStatusBadge.tsx` — shared status pill
- `src/components/pt/MarkPtStatusMenu.tsx` — shared trainer-side status picker

**Edited**
- `src/services/ptService.ts` — accept `status` arg
- `src/components/pt/TrainerTodayPanel.tsx` — use status menu
- `src/pages/MyClients.tsx` — replace single button with status menu
- `src/pages/MyAttendance.tsx` — add tabs, PT history, gated
- `src/pages/MyPTSessions.tsx` — add "Attendance" tab with status
- `src/App.tsx` — remove `/my-pt-sessions` redirect
- `src/config/menu.ts` — add `/pt-attendance`, gate PT items on `has_pt_package`
- Sidebar renderer — read `useMemberData().ptPackages` and filter menu items flagged `requires: 'has_pt_package'`

**Memory**
- Update `mem://features/pt-dual-mode` with status vocabulary, member-side gating rule, RBAC matrix.

### Out of scope (not changing)
- Turnstile / MIPS biometric flow — unchanged. Trainer "marks self" via existing staff-attendance flow.
- Membership/gym `member_attendance` schema — no new statuses added there; absent/holiday belong to PT, gym check-ins remain event-style.

### Open question
The "holiday" status: should it be markable for an entire day (bulk, all clients) or per-client only? Current plan is **per-client** for simplicity; bulk "Today is a holiday" can be added later as a one-tap that loops the same RPC.
