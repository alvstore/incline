---
name: MIPS device churn + face verification
description: Drift-based reconciliation, IST quiet hours, and recognition-based face-ledger verification for MIPS gates
type: feature
---

## Reconciliation (`mips-reconcile-devices` v2.3.0)
- Never rotate-and-repush blindly. v2.2.0 pushed 3 people (person + photo + syncPerson to every gate) every 15 min, 24x7 (~576 no-op dispatches/day) which kept the Android terminals rebuilding templates.
- v2.3.0 scans a rotating window of 60 roster entries locally and dispatches ONLY on drift: no successful `device_dispatch` in `mips_sync_attempts` for that (person, device), or last success older than 30 days.
- Deliberately NOT keyed off `members.updated_at` — unrelated row updates fire constantly and would re-queue everyone. Real changes are pushed by the event-driven sync path; reconciliation is a slow safety net only.
- Quiet hours 23:00–06:00 IST: nothing is dispatched unless `{force:true}`.

## Face ledger (`mips-face-sweep` v2.1.0)
- The firmware exposes only an aggregate face counter, never per-person state.
- **Tier A proof:** a successful `access_logs` face scan names the person AND the gate serial → that gate provably holds their template. Mark `mips_device_face_state` rows `enrolled` with zero MIPS traffic. Page `access_logs` explicitly (PostgREST caps at 1000 rows).
- Counter parity only degrades rows already pushed (`attempts > 0`) to `unverified`; never-pushed rows stay `pending`.
- `unverified` rows stay retry-eligible on a 6-hour cooldown; a static counter on an already-counted person never escalates to `rejected`.
- Entry-only gates legitimately leave exit-gate rows `unverified` until someone scans there.
