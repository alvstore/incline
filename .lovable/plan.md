# MIPS Gate Sync — Repair After the Device Reset

## What the live audit found (checked against your server just now)

- Both gates are **online and healthy**: Gate IN (`D1146D682A96B1C2`) and Gate OUT (`F06D92740D0062CF`), app `1.42.0.2`, heartbeats within the last minute.
- They were **re-registered today at 15:35 IST** and are now completely empty: `personCount 0`, `photoCount 0` on both. Before the reset they were stuck at 61 persons / 41 faces. So the reset did clear the frozen download queue — the roster now simply has to be pushed again from scratch.
- The server still holds **70 persons** (57 with photos), so nothing was lost server-side.
- CRM device rows still map correctly: `Gate 1 → mips_device_id 24`, `Entry 2 → mips_device_id 25`, serial numbers match the new device keys. No re-import needed.
- **The reset wiped the device callback URLs.** Both gates now report `sevUploadRecRecordUrl`, `sevUploadDevHeartbeatUrl` and `sevUploadRegPersonUrl` as `null`. Until these are restored the Live Access Feed will receive nothing when a member scans, even after faces are enrolled.
- `biometric_sync_queue` is 53 rows, all `succeeded` — so nothing is queued to re-push. The queue thinks the work is done; the gates disagree because they were emptied underneath it.

## Plan

### 1. Restore the device callback URLs (do this first)
Push the CRM webhook receiver URL back onto both gates via the device-update endpoint, so record upload, heartbeat and person-registration events flow again. Add this to the device import/verify path so a future reset self-heals instead of silently killing the Live Feed. Surface the callback state ("Callbacks: configured / missing") per gate on the Fleet tab.

### 2. Re-enqueue the full roster
One controlled backfill: enqueue every active CRM person who has a biometric photo and a MIPS person id into `biometric_sync_queue` as `pending`, so the existing drainer owns the work instead of a one-off script. Nothing else re-queues them today, which is why the gates have stayed at zero since the reset.

### 3. Make the sweep fast enough to actually finish
`mips-face-sweep` pushes 3 people per 5-minute tick — roughly 2 hours for 70 people, and it only reacts to a shortfall it can measure. For a cold gate it should burst: raise the batch to 10 when the measured shortfall is large (>20), keep 3 for steady-state top-ups. Same bounded 45s budget, so no timeouts.

### 4. Verify against the device, not the server
After the first batch, re-read `photoCount` from `GET /through/device/list` and confirm it is climbing from 0. This is the only device-side truth this firmware exposes. If `photoCount` stays at 0 while `syncPerson` keeps returning `200`, the terminals are rejecting downloads again and it is a device-side/vendor issue rather than anything in our pipeline — I'll report that rather than looping.

### 5. Operator visibility
Personnel Sync truth strip gains an explicit "backfill in progress — X of Y faces on Gate IN / Gate OUT" line with last sweep time, so you can watch 0 → 57 rather than guessing.

## About the Hostinger access

Not needed. Everything above is reachable through the MIPS HTTP API, which I can already reach and authenticate against from here. Server-level access would only matter if the MIPS application itself needed restarting — and the server is currently responding correctly, so it isn't the problem.

## Technical notes

- Files: `supabase/functions/mips-import-devices/index.ts` (write callback URLs on import/verify), `supabase/functions/mips-face-sweep/index.ts` (adaptive batch), `src/components/devices/PersonnelSyncTab.tsx` and `FleetTab` (progress + callback status), plus a one-off migration to re-enqueue the roster.
- Auth against MIPS requires the `TENANT-ID: 1` header on `/login`; without it the server answers `租户不存在`. Confirmed working.
- Success detection stays `json.code === 200 || json.code === 0`, never `response.ok`.
- `syncPerson` must keep `deviceNumType: "4"` — other values are rejected by this firmware.
