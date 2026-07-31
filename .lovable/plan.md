## Goal

`/devices` has grown to 10 components / ~3,100 lines with heavy duplication: the health strip, the MIPS dashboard hero and the connection card all report the same 4 numbers, and the debug panel holds raw API testers nobody uses. Collapse it to a lean, dense, 2026-grade console — fewer tabs, no duplicate stats, every button wired to something that actually works.

## New structure

Five tabs → **three**:

```text
Device Command Center            [branch] [Refresh] [Add Device]
┌──────────────────────────────────────────────────────────┐
│ Health rail: Server · Devices · Faces (parity) · Last hit │
│ Attention bar (only when something is wrong)              │
└──────────────────────────────────────────────────────────┘
[ Fleet ]  [ Personnel Sync ]  [ Live Feed ]      (Setup ⚙ = owner/admin only, moved out of tabs into a drawer)
```

- **Fleet** — merges old Overview + Devices. Device cards (online dot, SN, persons/faces/last-seen, door role, per-device face re-sync, open door, restart, register-in-CRM) plus one compact "fleet actions" row: Fleet Sync, Reconcile, Revoke expired. No hero card, no repeated KPI grid — those live in the health rail.
- **Personnel Sync** — same data, restyled: single toolbar (search + Members/Staff segmented control + Registered/Unregistered filter chips + Bulk verify / Bulk sync / Heal queue), dense rows instead of fat cards, sticky header, skeletons, empty states.
- **Live Feed** — realtime access events, unchanged logic, restyled to match; reconcile action kept inline.
- **Setup & Diagnostics** — no longer a tab. A gear button in the header opens a right-side Sheet (owner/admin) with webhook URLs + tokenized secret URL, and a "Diagnostics" section keeping only the checks that pass today (connection test, webhook simulate, E2E checklist).

## Deletions

- `MIPSDashboard.tsx` — hero + duplicate stats + offline-notification effect folded into Fleet tab / health rail.
- `MIPSConnectionCard.tsx` — status already in the health rail.
- `DeviceDebugPanel.tsx` — raw API testers dropped; the 2–3 useful checks move into the Setup sheet.
- Duplicate face/person aggregation math consolidated into one `useMipsFleet()` hook consumed by the rail, attention bar and Fleet tab (one query, no flicker).

## Files

- New: `src/components/devices/useMipsFleet.ts`, `DeviceFleetTab.tsx`, `DeviceSetupSheet.tsx`.
- Rewrite: `MIPSDevicesTab.tsx` (becomes card grid only), `PersonnelSyncTab.tsx` (toolbar + dense rows), `LiveAccessLog.tsx` (styling only), `DeviceHealthStrip.tsx` + `DeviceAttentionBar.tsx` (read from shared hook), `DeviceManagement.tsx` (3 tabs + gear).
- Delete: `MIPSDashboard.tsx`, `MIPSConnectionCard.tsx`, `DeviceDebugPanel.tsx`, `DeviceSetupPanel.tsx` (replaced by the sheet).

## Design

Vuexy: `rounded-2xl`, no borders, soft shadows, slate/indigo tokens, lucide icons only, colored status badges, skeletons on every query, empty states with a CTA, 44px touch targets, aria-labels on icon buttons. Fleet actions and Setup gated by `can.*` role checks.

## Not changing

No edge functions, no SQL, no MIPS service calls — all sync/door/face logic stays exactly as-is; this is a presentation-layer rebuild.
