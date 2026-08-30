# MIPS Android / Deployment Compatibility Audit — Plan

## First, three corrections to the brief

These matter because they change what the audit can and cannot answer.

**1. There is no v1/v3 API split in our code.** I searched the repo. Every `v1` / `v3` string in our MIPS integration is *our own edge-function semantic version* (`mips-proxy v1.4.1`, `_shared/mipsTime.ts v1.0.0`, `sync-to-mips v2.2.0`), not an API version. Our integration already speaks the RuoYi-Vue **v3** contract the deployed server exposes: `POST /login`, `TENANT-ID: 1`, `Bearer` token, `/through/device/list`, `/through/device/syncPerson`, `/personInfo/person`. There is no `/api/v1/*` path anywhere. So the v1→v3 migration, adapter layer, and phased cutover described in sections Sixth–Eighth have **no target in our codebase** and should not be built.

**2. MIPS is a closed third-party product.** The application at `212.38.94.228:9000/MIPS/` is a vendor build (RuoYi-Vue / Smart Pass / Tendcent). We hold no APK project, no MIPS frontend source, no service-worker or manifest, no MIPS database. Sections asking for `versionCode`/`versionName`, WebView version, service-worker version, and MIPS-side exception traces cannot be answered from source — only black-box, or by requesting them from the vendor.

**3. Our deploys do not talk to the terminals.** Publishing this app or deploying an edge function sends nothing to a device. Nothing in our code reboots a terminal automatically — `/through/device/reboot/{id}` is called only from the manual "Restart" button in `MIPSDeviceCard.tsx`. What *does* reach the terminals is a set of always-on cron workers, and those run whether or not we deploy.

## What the evidence already shows

Live data, last 24 hours:

| Signal | Value |
|---|---|
| `mips_sync_attempts` `device_dispatch` | ~24/hour, every hour, all night |
| `mips_sync_attempts` `photo_upload` | ~12/hour, every hour, all night |
| Same person re-dispatched | 12–18 times per day, repeatedly |
| `mips_device_face_state` state=`unverified` | 267 rows |
| `mips_device_face_state` state=`enrolled` | 5 rows |
| Active MIPS crons | 7 (1-min, 5-min ×2, 10-min, 15-min, 30-min, hourly) |
| Attendance still flowing | 34 member + 8 staff punches in 48h |

Each `device_dispatch` is a `/through/device/syncPerson` to both gates, which makes an Android terminal rebuild its local person index — externally that looks like the panel freezing, blanking or "restarting". The face ledger is the reason it never stops: 267 people sit at `unverified` and only 5 ever reached `enrolled`, so `mips-face-sweep` keeps re-pushing 2 people every 5 minutes forever, 24/7.

**Working hypothesis (to be confirmed, not asserted):** the terminals are not restarting *because of deploys*. They are being re-synced continuously by a non-converging enrolment loop, and a deploy is simply when someone is watching the panel. The v1/v3 mismatch is very likely a red herring.

## Audit plan

### Phase 1 — Inventory (what we can actually establish)
- Our side: edge function list + versions, cron inventory with schedules, API base URLs, auth mechanism (login → Bearer + TENANT-ID), all endpoints we call, timeout/retry/circuit-breaker behaviour in `_shared/mipsHealth.ts`.
- Vendor side, black-box: probe the live server for build/version banner, `/login` behaviour, device list payload (firmware/version fields per gate), and record the exact response schemas we depend on.
- Produce the dependency map with each layer labelled *owned by us* / *owned by vendor* / *unknown*.

### Phase 2 — Correlate restarts with dispatch (the decisive test)
Build a timeline joining `mips_sync_attempts` (dispatch timestamps), `access_logs` / `hardware_access_events` (device liveness gaps), and `mips-reconcile-devices` health results. If terminal gaps line up with `syncPerson` bursts rather than with our deploy times, the deploy theory is dead and the churn theory is confirmed.

### Phase 3 — Classify what "restart" is
Map the observed behaviour onto: full process restart / activity restart / person-DB re-index / network reconnect / server-side session reset. Distinguish them using device event gaps and the vendor's own device status, not assumption.

### Phase 4 — Face-ledger root cause
Determine why 267 rows never leave `unverified`: is the terminal rejecting photo quality, is `photoCount` attribution failing, or is the ledger never marked enrolled? This is the loop that must converge for the churn to stop.

### Phase 5 — Attendance safety review
Verify idempotency on the punch path (`staff_record_punch`, `reconcile-mips-pass-records`, `mips-webhook-receiver`) against the `device + person + timestamp + event_type` key, and confirm a mid-sync reload cannot drop or duplicate a punch.

### Phase 6 — Report
Findings classified CRITICAL / HIGH / MEDIUM / LOW, each with file/function references and live-data evidence, plus minimal safe changes and a rollback plan.

## Minimal safe changes I expect to propose (not applied in this plan)

- Make `mips-face-sweep` converge: cap attempts per person/device, mark permanently-rejected photos so they are never re-pushed, and go fully idle when the ledger is at parity.
- Add a no-op guard so a person whose MIPS payload and photo hash are unchanged is not re-dispatched.
- Add a quiet window so no bulk enrolment traffic hits the gates during opening hours.
- Add per-device dispatch observability (device_id, endpoint, status, latency, request id) without logging credentials or PII.

No business rules, roster maths, payroll, attendance logic, auth or schemas change.

## Technical scope

Read-only for this audit. Files that would be inspected: `supabase/functions/sync-to-mips/index.ts`, `mips-face-sweep`, `mips-face-parity`, `mips-access`, `mips-proxy`, `mips-reconcile-devices`, `mips-webhook-receiver`, `reconcile-mips-pass-records`, `process-biometric-sync-queue`, `_shared/mipsHealth.ts`, `_shared/mipsFaceState.ts`, `_shared/mipsTime.ts`, plus `src/services/mipsService.ts` and the Device Command Center components. Tables read: `mips_sync_attempts`, `mips_device_face_state`, `mips_connections`, `access_devices`, `access_logs`, `hardware_access_events`, `automation_rules`.

## What I need from you or the vendor

- Confirmation of which device visibly restarts (door gate vs. a tablet showing the MIPS web console).
- Vendor-side terminal logs, firmware version and `versionCode`/`versionName` — these do not exist in our codebase and cannot be inferred.
