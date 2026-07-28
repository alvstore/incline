# Live Access Feed — Fix Missing Turnstile Records

## What we confirmed
- `access_logs` table is **empty** right now — the MIPS webhook to `mips-webhook-receiver` is not landing (device is still configured with the old URL / missing `?token=`).
- The Live Feed's fallback path (direct poll of the MIPS server's `/through/record/list`) is wired in `LiveAccessLog.tsx`, but it's disabled when no single branch is selected:
  ```ts
  enabled: Boolean(branchId), // line 156
  ```
  On the Dashboard widget (`<LazyLiveAccessLog />`, no props) and on Device Command Center with "All Branches", `branchId` is empty, so the poll never runs and the feed appears empty even though Gate 1 / Gate 2 recorded Tejas & Aryan on the MIPS server.
- Dedupe key includes `message`, so once the poll runs, both webhook and MIPS rows survive correctly.

## Root cause
The direct MIPS-server poll is treated as branch-scoped, but the MIPS server itself is a single tenant with one active connection (`mips_connections` has one row for the main branch). So "no branch selected" should still poll the default MIPS connection, not skip.

## Fix (frontend-only, no schema changes)

### 1. `src/components/devices/LiveAccessLog.tsx`
- Remove `enabled: Boolean(branchId)` from the `mips-pass-records` query so polling runs whether or not a branch is selected. `fetchRecentMIPSPassRecords` already tolerates `undefined` branchId (mips-proxy falls back to the default active connection).
- Bump `refetchInterval` from 15s → 10s for the live feed (still light — one paged call).
- When `branchId` is undefined, request `limit * 2` from MIPS so the merged/sliced view still yields `limit` rows after dedupe.
- Surface poll failures inline: if `mipsError` and `initialEvents` is empty, render a small amber banner "MIPS server unreachable — showing webhook events only" (already have `mipsError`, just need the UI hook).
- Add a manual "Refresh" button in the card header that invalidates both queries — helps ops verify a scan appeared without waiting 10s.

### 2. `src/pages/Dashboard.tsx`
- Pass the currently selected branch (or `undefined`) to `<LazyLiveAccessLog />` so branch scoping stays consistent with the rest of the dashboard. Not strictly required after fix #1, but keeps the widget's counts aligned with the branch selector.

## Out of scope (already covered previously, only mention if user asks)
- Reconfiguring the physical device to point Recognition URL at `mips-webhook-receiver?token=…` — that's the persistent fix so `access_logs` starts filling again. The plan above ensures the UI works **now** even while that reconfiguration is pending.

## Verification
- Open Device Command Center → Live Feed with "All Branches" selected → within ~10s Tejas Latta (Gate 2) and Aryan Fanat (Gate 1) appear with the "MIPS" source chip.
- Switch to a specific branch → same rows still appear.
- Trigger a new scan on the turnstile → new row appears within one poll cycle.
