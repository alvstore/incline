# Trainer dashboard: reference-style redesign + member goals for trainers

## What the reference shows (adapted to Incline theme)
- Large page title + one-line subtitle, quiet top area.
- Row of 4 tall "hero tiles": solid colour fill, icon in a white rounded square, label, big number, small secondary line. Soft coloured glow under each tile.
- Right column "Contacts" rail: icon tiles with name, status line and a toggle.
- Tabs + filters above a list of rows: status dot, mini sparkline, big value, labelled progress bar, overflow menu.
- Bottom-right summary: two numbers over a slim bar chart with 30/15/7-day switch.

## Dashboard layout (bento, 12 columns)
```text
| Greeting + date + duty status                    |  My clients rail      |
| [Earnings] [PT clients] [Sessions] [Classes]      |  avatar, goal chip,   |
|  tall solid theme tiles, icon chip, glow          |  PT expiry, open btn  |
| Tabs: Today's sessions | PT attendance | Classes  |-----------------------|
|  rows: status dot, member, sparkline of visits,   |  Visits summary:      |
|  package progress bar (sessions used), menu       |  bar chart 30/15/7d   |
| My Tasks (compact)        | Week rota             |                       |
```
- Tiles use theme tokens only (primary, accent, success, info) with token-based glow; dark mode tested.
- Package progress bar = sessions used / total; sparkline = client's gate visits last 14 days.
- Mobile: rail drops below tiles; tiles become 2x2.

## Member goals visible to trainers
- Data already captured at registration: fitness goals, fitness level, health conditions, diet preference.
- Show a "Goal" chip on each client in My clients and Today's sessions.
- Tapping a client opens a right-side drawer "Client brief": goals, level, health conditions (flagged amber if any other than "None"), diet/cuisine, equipment, PT package and expiry. Read-only.
- Only for the trainer's own clients (assigned or PT package); served through a guarded server function so trainers can't read other members.

## Feature flag
- Branch setting `trainer_dashboard_v2` (default ON for all branches) switches between new and current dashboard, so it can be turned off instantly if something looks wrong. Remove old dashboard after 2-4 weeks.

## Technical details
- New RPC `get_trainer_client_briefs(p_member_ids uuid[])` SECURITY DEFINER, `rpc_guard_applies()` + caller-is-trainer-of-member check, returns goals/level/health/diet; EXECUTE to authenticated only.
- New `src/components/trainer/HeroTile.tsx`, `ClientRail.tsx`, `ClientBriefSheet.tsx`, `VisitsSummaryCard.tsx`; rework `TrainerDashboard.tsx` behind flag; TanStack Query, branch-scoped.
- Tokens: add `--shadow-tile-*` glow variables in index.css using existing colour vars (no new colours).
- Test: brief RPC refuses a member not linked to the trainer; health flag logic test.
- Verify with Playwright signed in as a trainer at desktop and 783px width.
