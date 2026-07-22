
## Scope

Five items from your last message. Grouped by system.

---

### 1. MIPS — Server-level personnel sync (parallel to all devices)

**Current behavior (verified in `sync-to-mips/index.ts`):** after upserting a person to the MIPS server, we call `POST /through/device/syncPerson` with an **array** of `deviceIds` for the branch. That IS the MIPS-native "parallel push to all devices" call — the server dispatches to every listed device in one shot.

**What's actually wrong:** the person is being created on the server but not appearing on *both* devices because `deviceIds` is being computed from `access_devices` where `mips_device_id IS NOT NULL AND is_online = true`. If the second device was ever offline during import, its `mips_device_id` may be null and it's silently skipped.

**Fix:**
- In `sync-to-mips`, replace the "online only" filter with **all mapped devices for the branch** (`mips_device_id IS NOT NULL`), regardless of `is_online` — MIPS server queues syncs for offline devices and delivers them on reconnect. Log per-device dispatch result for observability.
- Add a "Server-only" mode (`{ deploy_to_devices: false }`) — upserts the person on the MIPS server and lets the existing `mips-reconcile-devices` cron (already runs every 15 min) fan them out to devices. Useful for bulk imports.
- Toggle in `PersonnelSyncTab.tsx`: **"Sync to server (fan out later)"** vs **"Sync + push to devices now"**.

### 2. MIPS — Dual-device data sync audit

- **`mips-reconcile-devices/index.ts`**: currently only runs when a branch has ≥ 2 `is_online` devices. Change to ≥ 2 **mapped** devices so a briefly-offline device still gets caught up on the next tick.
- Increase `PER_RUN_CAP` from 100 → 500 with pagination, and log a per-person `ok/failed` breakdown into `mips_sync_attempts` for the Personnel Sync tab to display.
- Add a "Reconcile now" button on `MIPSDashboard.tsx` that invokes `mips-reconcile-devices` with `{ branch_id }` and shows the summary toast.

### 3. MIPS — Live Access Feed not receiving hits

**Verified:** `LiveAccessLog.tsx` subscribes correctly to `access_logs` INSERTs and invalidates on every event. The realtime channel needs the table to be in `supabase_realtime` publication.

**Fix:**
- Migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.access_logs;` (idempotent guard).
- In `mips-webhook-receiver`, ensure **every** identified hit (member/employee/unknown) writes an `access_logs` row before returning — audit shows the "unknown" branch currently skips the insert on some paths.
- Add `REPLICA IDENTITY FULL` on `access_logs` so realtime payloads include member_id for filter correctness.
- Add a small "Realtime: connected/disconnected" pill in the Live Access Feed header driven by the channel state so the operator knows if the stream is live.

### 4. RCS — Smartping endpoint parity

Confirmed Smartping endpoints from the Postman doc — implement what's missing:

| Endpoint | Purpose | Status |
|---|---|---|
| `POST /rcs/api/user/authorize` | 24h token | ✅ done |
| `POST /rcs/api/message/send` (standard/rich/carousel) | Send | ⚠️ standard only — add rich card + carousel payload builders |
| `POST /rcs/api/template/create` | Push template | ✅ done |
| `GET /rcs/api/template/list` | Sync templates | ✅ done |
| `POST /rcs/api/message/report` (delivery report) | DLR polling | ❌ missing → new `reconcile-rcs-pending` provider branch |
| `POST /rcs/api/campaign/*` | Campaign create/report | ❌ missing → optional, gated behind a "Use Smartping Campaigns" toggle |
| Webhook samples | Inbound + DLR | ⚠️ `rcs-webhook` handles Telinfy shape — extend to Smartping shape (`customOne=log_id` correlation) |

**Files touched:**
- `supabase/functions/send-rcs/index.ts` — extend Smartping branch with `richCard` and `carouselCard` component builders driven by `rcs_templates.kind`.
- `supabase/functions/reconcile-rcs-pending/index.ts` — add Smartping DLR poll path.
- `supabase/functions/rcs-webhook/index.ts` — accept Smartping webhook payload; write to `communication_delivery_events` via existing `log_id` lookup.
- `src/pages/RcsHub.tsx` — add Smartping curl snippets for the new endpoints under the Docs tab.

### 5. Self-registered members — preserve form fields

**Verified in `register-member/index.ts`:** the profile upsert writes exactly the form values, but a `handle_new_user` trigger (auth.users → profiles) fires first and can seed blanks that a later admin-panel save overwrites.

**Fix:**
- Update the trigger to only INSERT if `NEW.raw_user_meta_data->>'source' <> 'self_register'`, OR make it a pure `INSERT ... ON CONFLICT DO NOTHING` so `register-member`'s upsert wins.
- On `MemberProfileDrawer.tsx` save, diff against original — never PATCH fields the user didn't touch (prevents accidental blank overwrites).
- Add a `source_locked` flag on `members` so subsequent auto-imports (walk-in bulk, MIPS enroll) can't silently flip `source` from `self_register`.

---

## Out of scope (this plan)

- Reworking the MIPS transport layer (still HTTP/JSON via `mips-proxy`).
- Any UI restyling of the Device Center — only the two additions above.

## Deliverables

- 3 edge-function updates (`sync-to-mips`, `mips-reconcile-devices`, `send-rcs`, `reconcile-rcs-pending`, `rcs-webhook`, `mips-webhook-receiver`).
- 1 migration (realtime publication + trigger guard + `source_locked` column).
- 3 UI touches (`PersonnelSyncTab`, `MIPSDashboard`, `LiveAccessLog`, `MemberProfileDrawer`, `RcsHub`).
- No schema breaks, no data migration needed.

Approve and I'll implement in that order.
