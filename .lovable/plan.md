## Goal

Rebuild `/devices` (Device Command Center) as a single, coherent, premium ops console. All existing data logic (MIPS service calls, queries, mutations, edge functions) stays exactly as-is — this is a structural + visual redesign so the page is easier to read, easier to act on, and consistent with the rest of the app.

## Current problems

- The page is a thin wrapper around 5 tabs with very different visual languages (`MIPSDashboard`, `MIPSDevicesTab`, `PersonnelSyncTab`, `LiveAccessLog`, inline Debug JSX).
- ~180 lines of Debug/webhook markup live inline in `DeviceManagement.tsx` (396 lines) instead of a component.
- No single at-a-glance health strip — connection status, device online count, face parity (Gate 1: 41 vs Gate 2: 31) and last webhook event are scattered across tabs.
- Face-parity gap, unsynced personnel, and offline devices are only discoverable by clicking into tabs; there is no alert surface.

## New structure

```text
┌──────────────────────────────────────────────────────────┐
│ Device Command Center            [Refresh] [Add Device]  │
│ MIPS middleware · facial recognition & access control    │
├──────────────────────────────────────────────────────────┤
│ HEALTH STRIP (4 KPI tiles, always visible above tabs)    │
│ [MIPS Server] [Devices online] [Faces on device] [Feed]  │
├──────────────────────────────────────────────────────────┤
│ ATTENTION BAR (only when something is wrong)             │
│ e.g. "Gate 2 is 10 faces behind Gate 1"  [Re-sync faces] │
├──────────────────────────────────────────────────────────┤
│ Overview │ Devices │ Personnel Sync │ Live Feed │ Setup  │
└──────────────────────────────────────────────────────────┘
```

Tabs:
1. **Overview** — connection card + device tiles + recent-events preview (existing `MIPSDashboard`, restyled).
2. **Devices** — device cards in a responsive grid with consistent status badge, door role selector, and the Open Door / Restart / Re-sync faces actions grouped in a footer action row.
3. **Personnel Sync** — sub-tabs (Members / Trainers / Staff) with a sticky search + filter row ("Missing photo", "Not synced", "Unverified") and a compact person row.
4. **Live Feed** — full-width realtime log with granted/denied colour coding.
5. **Setup & Diagnostics** (owner/admin only) — the webhook callback URLs card + debug tools, extracted from the page into its own component.

## Visual system (project Vuexy rules)

- Cards: `rounded-2xl`, soft shadow, no hard borders; KPI tiles use a violet/indigo gradient hero for the primary metric.
- Status: colored badges only — online `emerald`, offline `red`, degraded `amber`, unknown `slate`.
- Icons: lucide only, 16px inline / 20px card headers.
- Skeletons for every loading state (KPI tiles, device grid, person rows), plus explicit empty and error states.
- Responsive: KPI strip 1→2→4 columns, device grid 1→2→3, no horizontal scroll at 375px.
- All icon-only buttons get `aria-label`; focus rings on all actions.

## Files

Edit:
- `src/pages/DeviceManagement.tsx` — reduce to header + health strip + attention bar + tabs (target under 120 lines).
- `src/components/devices/MIPSDashboard.tsx` — restyle to the new card/badge system, keep all queries.
- `src/components/devices/MIPSDevicesTab.tsx` — grid + unified device card layout, same handlers.
- `src/components/devices/PersonnelSyncTab.tsx` — sticky toolbar, filters, compact rows, same mutations.
- `src/components/devices/LiveAccessLog.tsx` — visual pass only.

New:
- `src/components/devices/DeviceHealthStrip.tsx` — the 4 KPI tiles (reuses existing `testMIPSConnection` / `fetchMIPSDevices` / face-parity queries).
- `src/components/devices/DeviceAttentionBar.tsx` — conditional alerts with inline fix actions.
- `src/components/devices/DeviceSetupPanel.tsx` — webhook URL config, moved out of the page.
- `src/components/devices/DeviceDebugPanel.tsx` — debug/test tools, moved out of the page.

## Out of scope

No changes to `mipsService.ts`, any edge function, database schema, or RLS. The Gate 1 / Gate 2 face gap is surfaced more clearly here but the underlying sync fix stays as already deployed.
