## Audit findings (`/devices`)

I curl-verified via DB (edge auth blocks anonymous curl) and read the code paths that render the Dashboard, Personnel Sync and Devices tabs. Three real, independent bugs — plus one data issue — explain everything the screenshot shows.

### 1. Persons/Faces stat is double-counted
`src/components/devices/MIPSDashboard.tsx` L162–163 does:
```
mipsFaces = Σ device.faceCount
mipsPersons = Σ device.personCount
```
With two devices each holding the same 33 members, this sums to 66. That is exactly the "wrong calculation / calculating double" behavior. `TOTAL SYNCED = 33` (from the DB) doesn't match this sum, so the Dashboard hero and the Personnel Sync cards disagree.

**Fix:** show `MAX(device.personCount)` and `MAX(device.faceCount)` — a person exists once on the MIPS server regardless of how many devices mirror it. Also add a small "on N/2 devices" sub-label so drift is visible instead of hidden.

### 2. The two devices show different sync counts
Root cause is a broken photo-upload pipeline, not the devices:

- `biometric_sync_queue` has **14 rows stuck `status=pending`, `retry_count=0`** (oldest from 2026-07-27). Six of them are `sync_type=photo_upload` with `device_id=NULL` — the queue writer inserts these but no cron drains them, so the picture that was "uploaded successfully" never reaches MIPS.
- The other 3 pending rows are `sync_type=add` targeted at device `6735a5b3… (Entry 2)` only — never fanned out to `Gate 1`. That is exactly why the two devices diverge.
- `mips-reconcile-devices` only re-pushes rows whose `mips_person_id IS NOT NULL`; anything stuck in the queue is invisible to it.

**Fix:**
- Add a `process-biometric-sync-queue` edge fn (or extend `mips-reconcile-devices`) that: (a) for `photo_upload` rows, re-calls `sync-to-mips` in `server-only` mode for that person; (b) for `add` rows with a `device_id`, replays syncPerson to the full mapped-device list of that branch, not just the single queued device. Mark row `succeeded`/`failed` with `error_message`.
- Register it in `automation_rules` under `automation-brain-tick` (every 5 min).
- Add an "Auto-heal drift" button on Dashboard that runs it on demand + surfaces `pending`/`failed` counts as a small badge on the Personnel Sync tab.

### 3. Mohit Gurjar & Rehan Khan not visible on device
DB says both are `mips_sync_status='synced'` with `mips_person_id` 98 and 105 — so the server has them, but:
- Mohit: `biometric_photo_path` set, `biometric_photo_url` still points at the **avatar bucket** — the sync used the avatar, not the biometric photo, so face-recognition fails silently on device.
- Rehan: `biometric_photo_path` is NULL — no biometric-quality photo was ever pushed; only an avatar URL.

Combined with #2 (queued `photo_upload` rows for both member IDs never processed), the devices never received the face templates, so they don't appear in the face-list on either terminal even though `personCount` includes them.

**Fix:**
- In `sync-to-mips`, prefer `biometric_photo_path` (signed URL) over `biometric_photo_url` when both exist, and reject/queue a re-shot if only an avatar is available (avatars ≠ biometric face crops).
- One-off backfill: for the two named members, re-enqueue a `photo_upload` and let the new queue worker push it once it exists.

### 4. UI/labeling polish while we are in the file
- `MIPSDevicesTab` shows "Public IP" from `access_devices.public_ip` — none is populated in DB, so it renders "—". Either hide the column when null or fall back to the MIPS-reported `device.ip`.
- Personnel Sync stats card shows `PENDING 2` while queue has 14 — that widget only counts members with `mips_sync_status != 'synced'` and ignores queue rows. Add a small "Queue backlog: N" chip sourced from `biometric_sync_queue` so operators aren't misled.

## Deliverables (build phase)

1. `src/components/devices/MIPSDashboard.tsx` — replace `Σ` with `Math.max` for `mipsFaces`/`mipsPersons`; add "on N/M devices" sub-label; wire a "Heal drift now" button.
2. New `supabase/functions/process-biometric-sync-queue/index.ts` (v1.0.0) — drains queue, retries with `retry_count++` + `error_message`.
3. Migration — insert `automation_rules` row `process_biometric_sync_queue` (every 5 min via automation-brain), and backfill re-enqueue for members `INC-26-0025` and `INC-26-0030`.
4. `supabase/functions/sync-to-mips/index.ts` — prefer `biometric_photo_path` over avatar; return `error='avatar_only'` when only avatar exists so the UI can prompt for a real face capture.
5. `src/components/devices/PersonnelSyncTab.tsx` — add "Queue backlog" chip; add "Heal now" action bound to the new fn.
6. `src/components/devices/MIPSDevicesTab.tsx` — hide/fallback the Public IP tile when null.

### Out of scope
Existing member-photo upload UX, RCS, campaign broadcast, biometric enrolment on device — nothing in those paths is touched.
