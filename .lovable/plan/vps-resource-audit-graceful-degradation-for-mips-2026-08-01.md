# VPS Resource Audit + Graceful Degradation for MIPS

## What the live audit actually found

I checked the server directly. **There is no Hostinger resource cap, throttle, or OOM kill in play.**

- Load average now `0.39 / 0.69 / 0.69` on 4 CPUs. Memory `4.0 GB used of 16 GB`, 12 GB available. Disk `24 GB of 193 GB (13%)`.
- No cgroup CPU or memory limits are applied (`/sys/fs/cgroup/memory.max` and `cpu.max` are absent — unrestricted KVM guest, not a container plan).
- No `oom-kill`, `killed process`, or `blk_throtl` entries in the current or previous boot journal. Pressure-stall counters are effectively zero for memory, 1.4% for CPU.
- No Hostinger/Imunify/monitoring agent service is running that could shape resources — only `qemu-guest-agent`.

**What did happen:** the previous boot's journal ends abruptly at `16:15:04` with no `Stopping…` / `systemd-shutdown` sequence, and the machine came back at `16:16`. That is an unclean host-level reset (Hostinger-side maintenance or a hard reboot), not a resource kill. Prior uptime was 16 days.

**Why that reset broke face sync:** `tomcat10.service` sets `WorkingDirectory=/opt/tomcat10`, while the MIPS config stores photos at the *relative* path `C:/smartPassSpace/uploadPath`. Before the reset the app was running from `/root`, so on restart it looked in a different directory and lost sight of 2,905 photos. Already mitigated today via a merged store plus symlinks; this plan makes it structurally impossible to recur.

**Real risks that do exist on this box** (capacity, not throttling): no swap is configured at all, and the VPS is heavily shared — a self-hosted Supabase stack (10 containers), MySQL (1 GB InnoDB pool), MongoDB, PowerDNS, Postfix/rspamd and Node services all coexist with MIPS. A memory spike has nowhere to spill, so the kernel would kill a process rather than slow down.

## Plan

### 1. Make the photo path reset-proof (server)
Set `profile:` in `application.yml` to an absolute path instead of the relative `C:/…`, so no working-directory change can ever orphan the archive again. Applied during a controlled restart, with the current symlinks kept as a fallback.

### 2. Add swap and a memory guard (server)
Create a 4 GB swap file with low swappiness so a spike degrades gracefully instead of triggering an OOM kill, and add `MemoryHigh`/`OOMPolicy` guards to `tomcat10.service` so MIPS is throttled before the kernel starts killing neighbours (or vice-versa). Tomcat already has `Restart=always` and is `enabled` at boot — verified — so it self-recovers from a host reset.

### 3. Graceful degradation in the CRM (app side)
Today the CRM treats an unreachable or restarting MIPS server the same as a data error: it retries hard, marks queue rows failed, and the UI shows nothing useful. Change to:
- Classify MIPS failures into *transport* (timeout, connection refused, 502/504) vs *data* (400/permission/validation). Transport failures back off exponentially and stay retryable; data failures fail fast.
- A short-lived circuit breaker: after repeated transport failures the sweep pauses instead of hammering a booting server, and resumes automatically once a health probe passes.
- Bounded timeouts on every MIPS call so an edge function can never hang until its compute limit.

### 4. Operator visibility on `/devices`
Add a server health strip: MIPS reachable / degraded / down, last successful contact, server uptime, and an explicit "sync paused — server unreachable, auto-resuming" state, so an outage reads as an outage rather than as silent failure.

### 5. Controlled restart procedure (only if needed)
A VPS-wide reboot is **not** warranted right now — face enrollment is actively progressing (Gate IN 51+, Gate OUT 20+ and climbing) and no resource metric is red. If a restart is ever needed, the order is: quiesce the CRM sweep, `systemctl restart tomcat10` (service-level only, ~30s), verify device counters resume. A full `reboot` stays reserved for kernel or host issues, since it also cycles the Supabase stack and mail services on this box.

## Technical notes

- Files: `supabase/functions/mips-face-sweep/index.ts`, `supabase/functions/sync-to-mips/index.ts`, `supabase/functions/process-biometric-sync-queue/index.ts` (error classification, backoff, breaker, timeouts); `src/components/devices/` health strip; server-side edits to `/opt/tomcat10/webapps/ROOT/WEB-INF/classes/application.yml`, `/etc/systemd/system/tomcat10.service`, and `/etc/fstab` for swap.
- Breaker state is stored in `settings` (branch-scoped) so all workers share one view rather than each function deciding alone.
- Server evidence gathered read-only this turn: `uptime`, `free -m`, `df -h`, `journalctl -b -1`, `/proc/pressure/*`, `systemctl cat tomcat10`, `sar -q`.
- The shared root password should be rotated — it was pasted in chat.
