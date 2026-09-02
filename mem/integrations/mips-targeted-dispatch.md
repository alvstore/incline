---
name: MIPS targeted dispatch (persionIssue) — the only way to push people to gates
description: Why /through/device/syncPerson broke the gates, the correct targeted endpoint, the push ledger, and the throttle contract.
type: feature
---
# MIPS targeted dispatch

## The bug (Sep 2026)
`POST /through/device/syncPerson` binds its body to a `TdxDevice` object on the RuoYi
server — that object has **no `personId` field**, so the personId we sent was silently
dropped and every call queued an asynchronous **FULL ROSTER DOWNLOAD** to the gate.
Server operation logs showed ~12,300 full downloads to Gate 2 and ~11,500 to Gate 1,
in bursts of 200+/minute. That is what kept the Android terminals rebuilding face
templates and restarting, and why Gate 2 stalled at 121 photos vs Gate 1's 130 vs the
server's 152. New members were also **never authorised on any gate** (no `authedLog`
rows at all) — they only existed on the server.

## The correct API
`PUT /personInfo/person/persionIssue`
```json
{ "personType": 1, "personIds": [263], "deviceIds": [24],
  "regionCodes": [], "numType": "2", "deviceType": "1", "authType": "1" }
```
- `numType` `"2"` = selected people, `"1"` = everyone
- `deviceType` `"1"` = selected devices, `"2"` = all
- `authType` `"1"` = issue, `"2"` = revoke
- HTTP/API 200 + msg "Personnel information is being issued…" means accepted.

Always call it **one person per gate** so delivery truth stays separable.

## Delivery truth
`GET /personInfo/authedLog/list?pageNum&pageSize[&personId]` — per person/device rows
with `pushStatus` (0 queued, 1 pushing, 2 delivered) and `failureMessage`.
**Never** infer face delivery from a device photo counter — that attribution was wrong
and produced bogus `rejected`/`unverified` verdicts (reset to `pending` in the fix).

## Code contract
- `supabase/functions/_shared/mipsDispatch.ts` is the ONLY dispatch path:
  `dispatchPerson`, `revokePerson`, `fetchPushLedger`, `latestLedgerState`,
  `claimDispatchSlot` / `releaseDispatchSlot`, `claimFullSyncSlot`, `dispatchFullRoster`.
- Callers wired: `sync-to-mips`, `mips-access`, `mips-face-parity`, `mips-face-sweep`,
  `src/services/mipsService.ts`.
- Throttle state: `mips_dispatch_state` (per gate `last_dispatch_at`, `in_flight_until`,
  daily counters, `last_full_sync_at`) via security-definer RPCs granted to
  `service_role` only.
- **Full roster sync is manual/maintenance-only** — Device Command Center → Fleet
  actions → "Full roster sync" (confirmation dialog), gated by `mips_claim_full_sync`,
  max once per gate per 24h unless a human forces it.

## Server facts
- Base URL has no `/prod-api` prefix: `POST http://<host>:9000/login`, header `TENANT-ID: 1`,
  bearer token. Photos JPG ≤400 KB, upload + full-object person PUT.
- Both gates: Gate 1 id 24 key `D1146D682A96B1C2`, Gate 2 id 25 key `F06D92740D0062CF`,
  versionCode 1.42.0.2, appVersion 3. Onsite APK version still unverified physically.
