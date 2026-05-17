## PT Attendance — Roster-Style Redesign

Replace the current filter+table view inside the **PT** tab of `/attendance-dashboard` with a roster-first workflow: pick a date, pick a trainer, see that trainer's PT clients as cards, mark attendance in one tap.

Scope: `src/components/pt/PtAttendanceTabContent.tsx` only. No DB schema changes. Reuses existing `log_pt_session` RPC and existing `pt_sessions` / `member_pt_packages` / `trainers` tables.

---

### Layout (3 zones)

```text
┌──────────────────────────────────────────────────────────────┐
│  Week strip:  Mon 12 · Tue 13 · [Wed 14] · Thu 15 · …   ◀ ▶ │
├────────────────┬─────────────────────────────────────────────┤
│  Trainers      │  Clients of {Trainer} · {Date}              │
│  ─────────     │  ┌────────┐ ┌────────┐ ┌────────┐           │
│  ● Avatar A    │  │ Member │ │ Member │ │ Member │           │
│  ○ Avatar B    │  │ 8/12   │ │ Monthly│ │ 3/10   │           │
│  ○ Avatar C    │  │[Mark ✓]│ │[Present│ │[Mark ✓]│           │
│  ○ Avatar D    │  └────────┘ └────────┘ └────────┘           │
└────────────────┴─────────────────────────────────────────────┘
```

- **Week strip (top):** 7 day-pills, horizontally scrollable, defaults to today. Arrows shift the window ±1 week. Active day uses indigo gradient pill; other days are slate. Tap to select.
- **Trainer rail (left, ~220px):** vertical list of active trainers with avatar + name. Selected trainer gets indigo accent bar + `bg-indigo-50` background. Trainer-role users see only themselves (auto-selected, rail hidden).
- **Roster grid (right):** responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` of client cards.

### Client Card

For each member with an active `member_pt_packages` row under the selected trainer:

- Avatar + name + member code
- Package badge:
  - Session-based → progress bar `sessions_used / sessions_total` + "X sessions left"
  - Monthly → calendar icon + "Monthly · valid till {date}"
- Today's session status (computed from `pt_sessions` for selected date + this member_pt_package):
  - **Not logged** → prominent full-width `Mark Present` button (indigo gradient). Long-press / kebab opens `MarkPtStatusMenu` for Late / Absent / Holiday / Cancelled.
  - **Logged (completed/late)** → disabled green pill "Present ✓ · {HH:mm}" + small "Undo" link visible to owner/admin/manager only.
  - **Other status** → coloured badge via existing `PtStatusBadge`.

### Data Flow

1. **Trainers query** (`['pt-roster-trainers', branchId]`): `trainers` joined to `profiles` where `is_active = true` and branch matches selection. Cached 5 min.
2. **Clients query** (`['pt-roster-clients', branchId, trainerId]`): `member_pt_packages` where `assigned_trainer_id = trainerId` AND `status = 'active'`, joined to `members` → `profiles` and `pt_packages` for name/type/totals.
3. **Sessions query** (`['pt-roster-sessions', trainerId, dateISO]`): `pt_sessions` where `trainer_id = trainerId` AND `scheduled_at` between `startOfDay(date)` and `endOfDay(date)`. Map `member_pt_package_id → session row` for O(1) lookup in cards.
4. **Mutation:** call existing `logPtSession({ memberPackageId, trainerId, status })` from `ptService.ts`. On success:
   - Optimistically set the card's session status to "completed" and decrement remaining sessions in the clients cache.
   - Toast: "Session logged for {member}. {N} sessions left."
   - Invalidate `['pt-roster-sessions', ...]`, `['pt-roster-clients', ...]`, and the parent `['pt-attendance-roster']` history key on success.
   - On error, roll back and toast the friendly message from `PT_LOG_ERROR_MAP`.

### History Section (kept, collapsed)

Below the roster, keep a collapsible "Recent attendance" panel that reuses the existing range/status/trainer filters + table from today's `PtAttendanceTabContent` so the audit/export-CSV workflow is not lost. Default collapsed.

### Empty / Loading / Error States

- No trainers → centered illustration + "No active trainers in this branch."
- Trainer selected, no clients → "No active PT clients assigned to {trainer}." with link to PT Packages.
- Loading → skeleton trainer rows + 6 skeleton cards.
- Mutation error → inline toast; button re-enables.

### Permissions

- **owner / admin / manager / trainer** → can mark (matches `log_pt_session` RPC).
- **staff** → roster is **read-only**: card shows status but `Mark Present` button is hidden with a tooltip "Staff cannot log PT sessions." Reason: the RPC explicitly rejects the `staff` role. If staff must log on behalf of trainers, that requires a DB migration to widen `has_any_role` in `log_pt_session` — out of scope for this UI plan, please confirm separately.
- Trainer-only users: rail auto-hidden, layout becomes a single column locked to their own roster.

### Realtime

Existing `useRealtimeInvalidate({ tables: ['pt_sessions'] })` is kept and rebound to the new query keys so a second device's logging reflects instantly.

---

### Technical Notes

- File touched: `src/components/pt/PtAttendanceTabContent.tsx` (rewrite). Extract `WeekStrip`, `TrainerRail`, `ClientRosterCard`, `HistoryPanel` as sibling components in the same folder (`src/components/pt/roster/`).
- Date handling via `date-fns` (`startOfWeek`, `addDays`, `isSameDay`, `startOfDay`, `endOfDay`).
- Reuse `MarkPtStatusMenu`, `PtStatusBadge`, `PtPackageBadge`.
- Branch filter (`selectedBranch`) applied to every query; "All Branches" view shows trainers across branches.
- No edge functions, no migrations, no nav changes.

### Out of Scope

- Schema/RPC changes (incl. enabling staff to log).
- PT scheduling, package purchase, or trainer commission logic.
- The Members / Staff-Record / Staff-Log / History tabs.
