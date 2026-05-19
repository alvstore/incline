
## Audit — current `/tasks`

Source: `src/pages/Tasks.tsx` (318 lines, single file, table-only view).

**What's weak**
1. Plain `h1 "Task Management"` + single "New Task" button. No context, no breadcrumb, no SLA/overdue framing, no view toggle.
2. Five identical stat cards (`Total / Pending / In Progress / Completed / Overdue`). All the same size, all numeric — no hero, no trend, no proportion.
3. Stat colors use raw Tailwind (`text-yellow-500`, `text-blue-500`) instead of the project's Vuexy semantic palette (`emerald-500 / amber-500 / blue-400 / red-500`). Same problem on the status/priority badges (`bg-yellow-500/10` etc.) — violates the project rule "Status always uses colored pill badges with `rounded-full px-2.5 py-0.5`".
4. Only one view: a flat table. No Kanban board, no calendar, no grouping by Today/Overdue/Upcoming. For a task manager in 2026 this is the biggest gap.
5. Filtering is a single Status dropdown. No search, no Priority filter, no "Mine" / "Unassigned" toggle, no saved views, no bulk select.
6. Loading state is a centered spinner — project standard is skeleton rows that match the table layout.
7. Empty state is a faint icon + "No tasks found" — no CTA, no illustration.
8. Assignee cell is a bare `<Select>` of names — no avatars, no initials, no role chip.
9. Due date is `new Date().toLocaleDateString()` — no relative time ("in 2d", "3d overdue"), no calendar pill, no SLA bar.
10. Mobile: 6-column table will horizontally scroll/clip; nothing collapses to cards. Violates project mobile standards.
11. Cmd+K deep-links (`?new=1`, `?task=…`) exist in code but there's no visible hint anywhere in the UI.
12. No realtime visual signal — rows just refetch silently.

## Redesign direction — 2026 Vuexy "Mission Control"

Goal: shift from a spreadsheet into a focused operations console, while keeping all current functionality (assign, change status, open detail drawer, realtime, Cmd+K).

**1. Header band**
- Breadcrumb `Operations › Tasks`.
- Page title `Tasks` + small subtitle "X open · Y overdue · Z due today" computed from `stats`.
- Right side: search input (`⌘K` hint) · view switcher segment `Board · List · Calendar` · `New Task` button (gradient `from-violet-600 to-indigo-600`).

**2. Bento KPI strip** (replaces the 5 equal cards)
```text
┌──────────────────────────────┬──────────┬──────────┐
│  TODAY'S FOCUS (gradient)    │ Overdue  │ Done 7d  │
│  N tasks · M overdue         │  count   │ sparkline│
│  [Open my queue →]           │          │          │
├──────────┬──────────┬────────┴──────────┴──────────┤
│ Pending  │ In prog. │ Completion rate ring (week)  │
└──────────┴──────────┴──────────────────────────────┘
```
- Hero card uses the project's gradient + white text rule.
- Smaller tiles use `rounded-2xl bg-white shadow-lg shadow-slate-200/50` (project standard).
- Each tile is clickable → applies the matching filter.

**3. Quick-filter pill row**
Chips: `All · Mine · Today · Overdue · High priority · Unassigned`. Active chip = filled indigo, others = slate outline. Chips persist to URL `?view=mine`.

**4. View switcher**

- **Board (default):** 4 swim-lanes (Pending / In Progress / Completed / Cancelled). Each card = title, priority dot, assignee avatar stack, relative due-date pill, comments count. Drag-and-drop changes status (calls existing `updateTaskStatus`). No new libraries — `@dnd-kit/core` is already a Vuexy-style fit; if not present, fall back to status-button menu on each card.
- **List:** the current table, but redesigned — assignee shows Avatar + name, due date becomes a relative pill (`amber` if <24h, `red` if overdue), status & priority use the project's pill standard, rows are `rounded-xl` with subtle hover lift, skeleton loading.
- **Calendar:** month grid by `due_date` (uses `date-fns`, already in project). Read-only initially; click a day to filter list.

**5. Detail drawer (already exists)** — keep, but ensure it animates from the right per the project's Sheet standard. No structural change required for this redesign pass.

**6. Mobile (<768px)**
Hero collapses to a single horizontally-scrollable KPI strip. Board switches to a single column that's the active swim-lane (lane picker on top). List view rows become stacked cards.

**7. Micro-interactions**
- Realtime: when a new task arrives, briefly pulse its card / row with `ring-2 ring-indigo-400` then fade out.
- Optimistic update on status change.
- Skeleton rows on first load.

## Technical notes (for implementation phase)

- New folder `src/components/tasks/`:
  - `TasksHeader.tsx` — breadcrumb, title, subtitle, search, view switcher, New Task CTA.
  - `TaskStatsBento.tsx` — gradient hero + 4 tiles + completion ring (`recharts` RadialBar, already in project).
  - `TaskFilterPills.tsx` — chip row, URL-synced.
  - `TaskBoard.tsx` — kanban swim-lanes (`@dnd-kit` if available, else menu fallback).
  - `TaskListView.tsx` — extract current table, restyle with semantic tokens + skeleton.
  - `TaskCalendarView.tsx` — month grid.
  - `TaskCard.tsx` — shared card used in Board + mobile List.
  - `AssigneeAvatar.tsx` — avatar w/ initials fallback, presence dot.
  - `DueDatePill.tsx` — relative time + color.
- `Tasks.tsx` becomes a thin orchestrator (`<200 lines`): state (view, filters, search), data hooks, renders header + bento + pills + active view + drawers.
- No business-logic changes: keep `fetchTasks`, `updateTaskStatus`, `assignTask`, `getTaskStats`, realtime channel, Cmd+K deep links, RBAC (visible to staff+).
- Colors: replace all `text-yellow-500 / bg-yellow-500/10` etc. with the project's semantic Vuexy pill tokens documented in project knowledge.
- Accessibility: every icon-only button gets `aria-label`; status pills use sufficient contrast (project rule ≥4.5:1); board cards are keyboard-reorderable (Space to pick up, arrows to move) when @dnd-kit is used.

## Scope boundary

- **In scope:** visual redesign + view switcher + filter pills + token cleanup + skeletons + mobile layout. All purely presentational + URL state.
- **Out of scope (unless you say otherwise):** schema changes, new RPCs, subtasks/checklists, attachments, time-tracking, automation rules, recurring tasks.

## After plan approval

Once you confirm, I'll also call `design--create_directions` to generate 3 visual prototypes of the **bento KPI strip + board lane** so you can pick the exact 2026 aesthetic (e.g. glass-card vs flat-card vs gradient-heavy) before I implement.
