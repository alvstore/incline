# MIPS gate sync audit — root cause and fix plan

## What I actually found (live evidence)

I logged into the MIPS server (HTTP API + SSH) and read the Tomcat operation log.

**1. Both gates are on the same app version.** Live `/through/device/list`:

```text
Gate 1  D1146D682A96B1C2  versionCode 1.42.0.2  appVersion 3  persons 136  photos 130
Gate 2  F06D92740D0062CF  versionCode 1.42.0.2  appVersion 3  persons 136  photos 121
```

So the "v1 vs v3" difference is not visible on the server: the server records both terminals as appVersion 3. Any v1/v3 difference lives in the APK installed on the Gate 2 hardware and must be confirmed on the device screen (About → app version), not from the server.

**2. The real defect: every personnel push we send is a FULL roster download, not a single-person push.**
The server operation log records the exact request bodies our edge functions send. Every one of them looks like this:

```text
POST /through/device/syncPerson
body    {"deviceIds":[25],"deviceNumType":"4","params":{"dataScope":""},"tenantId":1}
result  {"code":200,"msg":"正在下载人员信息中！"}   ("downloading personnel info")
```

There is **no `personId` in any request** — not one, across the whole log. The controller
(`TdxDeviceController.syncPerson`) binds the body to a `TdxDevice` object, which has no
`personId` field, so the `personId` we send is silently discarded and the server kicks off an
asynchronous **whole-roster download** to that gate.

Counts in the retained log:

```text
deviceIds [25] (Gate 2)  12,313 full-roster downloads
deviceIds [24] (Gate 1)  11,482
deviceIds [24,25]         3,363
older device ids          ~7,500
```

Bursts of 200+ downloads inside a single minute are visible (e.g. 23:30, 23:45, 13:07).

**3. This explains all three symptoms.**
- *Restarts after every sync*: each call makes the terminal re-pull and rebuild face templates for the entire roster; overlapping downloads exhaust the terminal and it reboots.
- *Gate 2 rejects / lags*: Gate 2 receives the most full downloads. Each new download interrupts the previous one, so it never finishes a complete pass — 121 photos against Gate 1's 130 and the server's 152. It is not rejecting individual photos; it never gets to finish.
- *False "Retake needed"*: `mips-face-sweep` attributes a `photoCount` change to the single person it "pushed". Since the push is actually a full roster sync, that attribution is meaningless, and members like INC-26-0141/0142 are marked `rejected` even though their photo may be fine.

**4. Likely correct per-person API.** `SysPersonController` exposes `/personInfo/person/collect`,
and internally reads `personIds` + `deviceIds` and resolves devices by id — the shape of a real
targeted dispatch. This must be proven with a live call before we build on it.

## Plan

### Phase 1 — Prove the targeted dispatch endpoint (no code changes yet)
- Call `POST /personInfo/person/collect` with one `personId` and one `deviceId` against Gate 1, watch `photoCount` and the operation log, and confirm it dispatches only that person.
- Try the documented alternates if it does not (`/through/device/{id}/persons`, `deviceNumType` 3/5 variants) and record the winner in the API reference doc.
- Deliverable: a verified "push exactly one person to exactly one gate" call.

### Phase 2 — Replace the dispatch layer
- Add `_shared/mipsDispatch.ts` with two explicit operations: `dispatchPerson(personId, deviceIds)` (targeted, Phase-1 endpoint) and `dispatchFullRoster(deviceId)` (the current `syncPerson`, rarely used).
- Point `sync-to-mips`, `mips-access`, `mips-face-parity`, `mips-face-sweep` and `src/services/mipsService.ts` at `dispatchPerson`. No routine path may call the full-roster endpoint again.

### Phase 3 — Stop the churn (immediate relief even before Phase 2 lands)
- Serialize dispatches per gate: one in-flight operation per device, tracked in the database, with a minimum spacing between pushes and a hard daily cap.
- Full-roster sync becomes manual-only (an explicit button in Device Command Center) plus an at-most-once-daily maintenance window outside gym hours.
- Keep the existing quiet hours and circuit breaker.

### Phase 4 — Re-baseline the face ledger
- Clear every `rejected` / `retake needed` verdict in `mips_device_face_state` that was produced by the invalid attribution, back to `pending`.
- Re-run the sweep on the corrected dispatch so verdicts mean something, then confirm Gate 1 and Gate 2 both converge on the server's 152 photos.

### Phase 5 — Hardware / app-version check (needs someone at the gym)
- Read the installed app version on both terminals; if Gate 2 runs the older v1 build, plan the APK upgrade to match Gate 1. Record both versions in the device inventory so the fleet view surfaces a mismatch.

### Phase 6 — Memory
- Update `mem://integrations/mips-*` with: `syncPerson` ignores `personId` and always means full roster download; the verified targeted endpoint; per-gate serialization rule; and the rule that a `photoCount` delta may never be attributed to a person unless the dispatch was provably targeted.

## Technical notes
- Server: Tomcat 10 at `/opt/tomcat10`, app in `webapps/ROOT` (API) and `webapps/MIPS` (UI), logs in `/opt/tomcat10/logs` (currently 5.7 GB — worth a rotation policy as a side task).
- Evidence used: `sys_oper_log` inserts in `catalina.out` (full request/response bodies), `localhost_access_log.2026-09-02` endpoint histogram (763 `syncPerson`, 110 photo uploads, 1554 heartbeats today), and the decompiled `TdxDeviceController` / `SysPersonController` string tables.
