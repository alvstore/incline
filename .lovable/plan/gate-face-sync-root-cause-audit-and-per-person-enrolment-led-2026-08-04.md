# Gate Face Sync — Root Cause Audit and Per-Person Enrolment Ledger

## What the live server says right now (checked directly this turn)

- Gate 1 (`D1146D682A96B1C2`, MIPS id 24) and Gate 2 (`F06D92740D0062CF`, id 25) are both online, firmware `1.42.0.2`, heartbeats within the minute.
- MIPS server holds **83 persons, 76 of them with a `photoUri`**.
- Both gates report `personCount 83`, but faces are **Gate 1 = 69, Gate 2 = 70**.

So the real gap is not "Gate 1 is one photo behind Gate 2". Measured against the server, **Gate 1 is 7 faces short and Gate 2 is 6 faces short**. The two gates simply disagree on one of those, which is what makes it look like a one-photo lag. Persons are fully issued to both gates; only face templates are missing.

## Root cause

Three separate problems compound:

1. **The only device-side signal we have is a single number.** `photoCount` on `GET /through/device/list` is the sole face metric this firmware exposes over HTTP. I probed the API for a per-device person or issue roster (`/through/devicePerson/list`, `/through/personDevice/list`, `/through/deviceSync/list`, `/through/task/list`, `/interface/exterior/getPersonDeviceList` and others) — **none exist on this build**. With only a count, no worker can ever name the missing person, so the sweep re-pushes people blindly and hopes the number climbs.
2. **Some photos are accepted by the server but rejected by the terminal.** `syncPerson` returns `200` regardless; the gate then discards images it cannot extract a face template from (no face found, face too small, multiple faces, heavy compression). Those persons are permanently missing while `photoCount` stays flat — and because the sweep sorts by "oldest verified first", the same rejected photos are re-pushed forever, burning resources every 5 minutes without ever converging. This is exactly why the problem keeps coming back.
3. **The gates' callback URLs are null.** Both devices report `sevUploadRegPersonUrl`, `sevUploadRecRecordUrl` and `sevUploadDevHeartbeatUrl` as `null` — wiped by the device reset and never restored. `sevUploadRegPersonUrl` is the person-registration callback: the one channel that would tell us, per device and per person, whether a face actually enrolled. Without it we are blind by construction.

## Plan

### 1. Restore the registration callback and turn it into per-person truth
Write the CRM webhook URL back onto both gates (`sevUploadRegPersonUrl`, `sevUploadRecRecordUrl`) and make `mips-import-devices` re-assert them on every verify, so a future reset self-heals. Extend `mips-webhook-receiver` to record registration results into a new `mips_device_face_state` table keyed by `(device_id, person_sn)`: enrolled / rejected / pending, with the device's reason and timestamp. This is the ledger the system has never had.

### 2. Derive the missing person from that ledger, and from the count as a cross-check
A new `mips-face-audit` action returns, per gate, the exact list of people whose face is not enrolled — names and member codes, not a number. Until the ledger fills, it falls back to a deterministic probe: push one person, re-read `photoCount`, attribute the delta. Slow, but it names the 7 on Gate 1 without guesswork.

### 3. Stop pushing everyone — push one or two, only when needed
Replace the rotating-batch sweep with event-driven, ledger-driven sync:
- A photo change (avatar upload, biometric replacement) enqueues **that person only**, already the case via `tg_push_photo_to_mips` — keep it.
- The periodic worker pushes only people marked `pending` or `missing` in the ledger, capped at 2 per tick per gate, and **never re-pushes a person marked `rejected`** until their photo actually changes.
- Rejected photos surface as an operator task ("photo unusable — retake"), which is the honest resolution: no amount of re-pushing fixes an image with no detectable face.
- When the ledger says every gate is at parity, the worker does nothing at all — no login, no traffic.

### 4. Validate the photo before it ever reaches a gate
Add a pre-flight check on upload: minimum resolution, single detectable face, sane file size, re-encode to the profile the terminal accepts. Reject at upload time with a clear message instead of discovering it silently at the gate a day later.

### 5. Operator visibility
The Personnel Sync tab shows a per-gate table: enrolled / pending / rejected with names, last attempt, and the reason a photo was rejected — replacing the current "69 of 76" number that cannot be acted on.

## Membership days left on the turnstile

Short answer: **the stock APK cannot show it, and it does not need a custom APK to be useful.**

The MIPS person record has no free-text display field — it carries `name`, `personSn`, and `validTimeBegin` / `validTimeEnd`. The gate screen renders the person's `name` and a greeting; that is all the firmware exposes.

Three options, in order of what I would recommend:

1. **Do nothing on the device; enforce validity instead (already working).** `validTimeEnd` is set from the membership end date, so an expired member is blocked at the gate. Days-left is an informational need, better served where the member actually looks.
2. **A lobby display driven by our webhook (recommended).** Every scan already hits `mips-webhook-receiver`. A small screen next to the gate can greet the member and show "12 days left" with full styling and branding, with no vendor dependency. Also naturally covers dues and expiry warnings.
3. **Encode it into the name field** (e.g. `Hozefa B. (12d)`). Zero vendor work, but it would need a daily rewrite of every person record on the server, it pollutes attendance and access logs with a changing name, and it risks breaking the personSn/name-based lookups. Not recommended.

A custom APK from the vendor is the only way to render it natively on the turnstile itself, and it would need to poll our API per scan. Worth requesting only if the lobby display is not acceptable.

## Technical notes

- New table `mips_device_face_state` (device_id, person_sn, person_type, person_id, state, reason, last_attempt_at, enrolled_at) with branch-scoped RLS and grants.
- Files: `supabase/functions/mips-webhook-receiver/index.ts` (registration callback → ledger), `supabase/functions/mips-face-sweep/index.ts` (ledger-driven, 2-per-tick, honours `rejected`), `supabase/functions/mips-face-parity/index.ts` (adds a naming audit action), `supabase/functions/mips-import-devices/index.ts` (re-assert callback URLs), `src/components/devices/PersonnelSyncTab.tsx` (per-person table), plus photo pre-flight in `src/lib/media/syncPersonPhoto.ts`.
- MIPS auth requires the `TENANT-ID: 1` header; `syncPerson` must keep `deviceNumType: "4"`; success is `code === 200 || code === 0`, never `response.ok`.
- The MIPS MySQL database does hold a device-person issue table that the HTTP API does not expose. If you want the 7 missing names *today* rather than after the ledger fills, I can read it directly over SSH — that needs the VPS credentials again (they were rotated after being pasted in chat).
