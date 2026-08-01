# MIPS Server-Side Repair — Restart the Service and Re-drive the Gate Sync

You've given me root access to the MIPS host. That changes what's possible: until now I could only reach the MIPS HTTP API, which reported success while the gates ingested nothing. With shell access I can look at the layer the API hides — the MIPS application process, its own logs, and the device push/download queue it maintains.

I can't run any of this while in plan mode (no state-changing commands), so here is exactly what I'd do once you approve.

## What we already know

- Both gates are online and heartbeating: Gate IN (`D1146D682A96B1C2`, MIPS device 24) and Gate OUT (`F06D92740D0062CF`, device 25), firmware 1.42.0.2.
- Since the device reset they report `personCount 0` / `photoCount 0`. Before the reset they were frozen at 61 persons / 41 faces.
- The MIPS server still holds ~70 people (57 with photos), so no data was lost server-side.
- `syncPerson` returns `code 200` ("downloading person info"), yet no terminal counter ever moves — the server accepts the job and never delivers it.
- The reset also nulled the gates' `sevUpload*` callback URLs, and the device management API refuses to set them back.

That pattern — API says OK, nothing is delivered, callbacks unsettable — points at the MIPS application's own push worker being wedged, not at our CRM pipeline.

## Plan

### 1. Inspect before touching anything
Log in over SSH and capture the current state: which MIPS processes are running (Java/Spring service, MySQL/Redis, nginx), uptime, memory and disk headroom, and the tail of the MIPS application log around the time sync stopped (yesterday). Full disk and an OOM-killed worker are the two most common causes of exactly this "accepts but never delivers" behaviour, and both are visible in seconds. Also check whether the MQTT/WebSocket port the terminals connect on is actually listening and whether the gates hold live connections to it — the gates can heartbeat over HTTP while their persistent push channel is dead.

### 2. Read the queue, not the API
Find the download/dispatch queue table in the MIPS database and count rows for devices 24 and 25. This tells us definitively whether jobs are piling up unsent (server worker stuck) or being marked delivered with nothing arriving (device-side refusal). That single number decides the rest of the repair.

### 3. Restart the MIPS service
Restart the MIPS application (and its dependencies only if step 1 shows they're unhealthy), then wait for the gates to re-establish their connections and confirm both reappear as online with a live push channel.

### 4. Re-drive the roster and watch the device counters
Trigger one `mips-face-sweep` burst from our side and watch `photoCount` on both gates climb from 0. Device-side counters are the only truth here — server-side "success" has already proved worthless. If they move, let the sweep run to parity (~20 minutes for the full roster at burst size).

### 5. Restore the callbacks
With the service healthy, set the `sevUploadRecRecordUrl` / `sevUploadDevHeartbeatUrl` / `sevUploadRegPersonUrl` values back to our webhook receiver — via the database or the MIPS admin UI if the device API keeps rejecting them. This is what brings the Live Access Feed back; attendance itself is unaffected because we poll pass records every few minutes.

### 6. Verify end to end, then report
Enroll-check one member on each gate, then have someone scan and confirm the event lands in the Live Access Feed. I'll keep iterating on steps 3-5 until the counters actually move, and if the blockage turns out to be inside the terminals rather than the server, I'll say so plainly with the evidence rather than looping.

## Notes

- I'll use the credentials you pasted only for this repair and won't echo them anywhere. Please rotate that root password once we're done — it's now been shared in chat.
- No CRM code changes are expected from this. If step 2 reveals our push payload is being rejected for a specific reason, I'll come back with a follow-up plan rather than silently changing the sync functions.
- Restarting the MIPS service will briefly interrupt door-open commands and record uploads; queued records are retained and re-uploaded, so nothing is lost.
