## Problem

Love Kumar Paliwal bought a membership that starts **27 Jul 2026**. The plan exists in the DB as `memberships.status = 'pending'` with a future `start_date`. But on the Members list:

- **Status** column shows `inactive` (because no `status='active'` row matches today)
- **Membership** column shows `No Plan` (because the same filter excludes `pending`)
- He is also counted under the **Inactive** KPI tile

This is wrong — a member who has *paid and is scheduled to start* is not the same as a member with **no membership at all**. The Members page treats "no active row" as "inactive", with no awareness of the new `pending` (Scheduled) state we introduced for advance bookings.

## Goal

Introduce **Scheduled** as a first-class member status across the Members list, KPIs, badges, and counts — clearly distinct from `inactive` ("never bought / lapsed") and `active` ("plan running today").

## Scope (UI / presentation only — no schema or RPC changes)

All edits in `src/pages/Members.tsx`. The data is already correct in the DB; we just need to read the `pending` row and render it properly.

### 1. Status derivation (lines ~158–182)

Extend the per-member status reducer to recognise scheduled memberships:

```text
priority:
  pending_plan  → "Pending Plan"      (lifecycle_state, unchanged)
  active        → "Active"            (status='active' AND end_date >= today)
  scheduled     → "Scheduled"         (status='pending' AND start_date > today)   ← NEW
  frozen        → "Frozen"            (status='frozen')
  inactive      → "Inactive"          (nothing else)
```

Also expose the scheduled membership row on the member object as `scheduledMembership` so the Membership column can render it.

### 2. KPI tiles (lines ~279–290, 440–470)

- **Active** count: unchanged (only truly active today).
- **Inactive** count: subtract scheduled members so Love no longer inflates this tile.
- Add a new **Scheduled** KPI card between **Active** and **Inactive**:
  - Icon: `CalendarClock` (lucide)
  - Color: indigo/violet (`border-l-indigo-500`, `bg-indigo-50 text-indigo-600`)
  - Click → `handleStatusFilter('scheduled')`
- Keep the 5-card row responsive (already grid; add the 6th tile, allow wrap on smaller screens).

### 3. Status badge (lines ~292–301, 587–591)

Add `scheduled` to `getStatusColor`:
```text
scheduled → bg-indigo-50 text-indigo-700 border-indigo-200
```
Badge label: `Scheduled · starts DD MMM` (use the scheduled row's `start_date`, formatted with `format(date, 'dd MMM')`). Prefix with a small `CalendarClock` icon.

### 4. Membership column (lines ~593–621)

Render order inside the cell:
1. If `activeMembership` exists → current behaviour (plan name + Frozen/Due badges).
2. Else if `scheduledMembership` exists → show:
   - Solid indigo badge with plan name (e.g. `Annual Plan`)
   - Secondary outline badge: `Starts 27 Jul 2026` (indigo-tinted)
   - Plus the existing `Due ₹X` badge if any
3. Else → existing `No Plan` dashed badge.

This removes the misleading "No Plan" for Love and tells reception exactly when his access turns on.

### 5. Days Left column (lines ~623–640)

For scheduled members show `Starts in Nd` (computed `differenceInDays(start_date, today)`) with a neutral indigo color and `CalendarClock` icon, instead of `--`.

### 6. Filter chip / status dropdown

Add **Scheduled** as a selectable filter value wherever the status filter is offered, so staff can list only upcoming starts.

### 7. Search RPC fallback (lines ~119–135)

`search_members` RPC returns only `member_status` and no memberships, so server-side search currently can't distinguish scheduled members. Two options — pick one:

- **(preferred, no DB change):** when search is active, after the RPC returns, do a follow-up `memberships` query for the returned `member.id`s (same shape we already do in `member-memberships` query at line 215) and run the same derivation. Keeps the RPC untouched.
- Alternative: extend `search_members` to also return `scheduled` flag. Out of scope unless we want it.

I will use the first option.

### 8. Code review / consistency pass

- `MemberProfileDrawer` already received scheduled-membership treatment in the previous turn — confirm the list page uses the same date formatting and badge tokens for visual consistency.
- No changes to `membershipService.fetchActiveMembership`, `purchase_membership` RPC, MIPS sync, or cron — those were settled in the prior plan.
- No new TypeScript `any` introduced; reuse existing membership row type.

## Out of scope

- DB schema, RPC, cron, or MIPS changes.
- Member-portal (member-facing) views — separate task if needed.
- Backfill (Love is already `pending` with `start_date = 2026-07-27`).

## Files to edit

- `src/pages/Members.tsx` (status derivation, KPI grid, badges, Membership cell, Days Left cell, filter handler, search-path enrichment)

## Acceptance

For Love Kumar Paliwal on 24 Jun 2026:
- Status badge: **Scheduled · starts 27 Jul** (indigo)
- Membership cell: plan name + `Starts 27 Jul 2026` + `Due ₹25,000`
- Days Left: `Starts in 33d`
- KPI tiles: Active **0**, **Scheduled 1**, Inactive **0**
- Clicking the Scheduled tile filters the table to him.
