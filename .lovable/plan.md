# MIPS Restart Incident — Stabilization, Root Cause, Backup, and Fix Plan

## Confirmed findings

- Full-roster downloads are no longer used by routine app code; they remain behind the manual **Full roster sync** action.
- The gates are still receiving excessive targeted personnel work: the dispatch ledger shows **211 claims today per active gate**.
- Three enabled scheduled writers can issue personnel to gates:
  - face-enrolment sweep every 30 minutes;
  - personnel delta sync hourly;
  - device reconciliation every 2 hours.
- At 16:30 IST, the face sweep and delta sync ran together. Two gate pushes for the same person were then left pending.
- The face ledger is mostly converged: 316 enrolled, 2 pending, 6 terminally rejected. A near-converged ledger should not generate hundreds of daily gate claims.
- The same member was dispatched to both gates twice within roughly 12 hours despite successful prior delivery. This confirms duplicate re-issue paths still exist after the original full-roster bug was removed.
- Routine access enforcement also sends targeted issue/revoke commands. Its corrective read-back path can issue the same person again when verification is delayed.
- The throttle currently fails open when its database bookkeeping errors, and its default daily cap is 800 per gate. Neither behavior is safe during this incident.
- The existing disaster-recovery system is a cold standby mirror. It can make a current database/auth/storage copy and verify parity, but it cannot automatically switch the live app or mirror server functions.

## Phase 1 — Immediate stabilization

1. Pause only the three non-essential gate writers: face sweep, personnel delta sync, and device reconciliation.
2. Keep attendance ingestion running so entry/exit records continue to arrive.
3. Keep payment/access enforcement available, but serialize it to one targeted command per changed person and gate.
4. Capture pre-cleanup evidence from the VPS:
   - Android/Tomcat process restarts and kernel out-of-memory events;
   - MIPS issue/release queue counts grouped by status, person, and gate;
   - repeated jobs and failure messages for the six known bad-photo members;
   - device uptime, memory, face counts, person counts, firmware, and last reconnect times.
5. Do not clear queues until the evidence is saved. Then remove only stale duplicate/retry rows; preserve legitimate current issue/revoke work.

## Phase 2 — Make a fresh disaster-recovery copy

1. Run the existing owner-authorized **all** backup to copy schema, auth users, rows, and storage to the configured standby.
2. Run parity verification immediately afterward and retain its row/storage mismatch report.
3. Record the backup timestamp and result in the recovery audit log.
4. If parity fails, stop before any cutover and repair the mirror discrepancy.
5. Keep the recovered primary as live unless it becomes unreachable again. The standby is cold and requires an explicit app configuration change plus function deployment.

## Phase 3 — Prove the restart mechanism on the VPS

Build one timestamped timeline containing:

```text
scheduled worker → person/gate issue request → MIPS queue job
→ Android memory/heartbeat change → process restart or OOM
```

Classify each visible interruption as one of:
- Android application process restart;
- OS/device reboot;
- face-template rebuild with frozen UI;
- network reconnect;
- MIPS server worker restart.

The fix will be based on this correlation, not on edge-worker boot/shutdown messages.

## Phase 4 — Eliminate duplicate gate work

1. Add one canonical dispatch-intent check before every targeted issue:
   - person payload fingerprint changed; or
   - photo fingerprint changed; or
   - access validity/action changed; or
   - no successful delivery exists for that person and gate.
2. Store and compare the last successful per-person/per-gate intent fingerprint. Unchanged intent becomes a no-op.
3. Make face sweep verification-only for enrolled people. It may issue only genuinely pending new photos and must stop after the bounded retry limit.
4. Make delta sync server-record-only by default. Gate issue happens only when its intent changed.
5. Make reconciliation verify drift from delivery truth; remove the age-only re-issue rule.
6. Prevent overlapping writers with one shared per-person/per-gate lock and dedupe key.
7. Change throttle failure from fail-open to fail-closed for background workers. Preserve a tightly controlled bypass only for urgent access revocation.
8. Reduce the background daily cap from 800 to an operationally safe limit and alert before the cap is reached.
9. Treat unacceptable photos as terminal `photo_rejected`; never requeue them until a new photo hash is uploaded.
10. Correct the audit-status constraint so `deferred`/`skipped` outcomes are recorded without database errors.

## Phase 5 — VPS queue and photo remediation

- Confirm the six reported photos are absent or terminally blocked before any re-upload.
- Re-upload only clear, close-up, single-person, front-facing photos.
- Issue each corrected member once per gate and wait for completion before the next person.
- Resolve duplicate-mobile person records separately; they must not enter an automatic retry loop.

## Phase 6 — Verification and controlled restart

1. Observe both gates with background writers paused for at least one normal operating window.
2. Confirm no process restart/OOM and stable memory/uptime.
3. Re-enable workers one at a time: access enforcement, delta verification, reconciliation, then face sweep.
4. Require these acceptance checks:
   - zero full-roster requests from scheduled code;
   - zero unchanged-person re-issues;
   - no rejected-photo retries;
   - no overlapping dispatches to one gate;
   - attendance continues without gaps or duplicates;
   - successful payment/revocation changes reach both gates once;
   - queue returns to idle after each change;
   - no Android restart or face-engine OOM during the observation period.
5. Add an operational alert for abnormal issue volume, queue age, repeated person/gate pairs, and device uptime reset.

## Recovery and rollback

- Before code or queue changes: complete and verify the cold-standby backup.
- Roll back by pausing all background gate writers and retaining only attendance ingestion plus manual emergency access control.
- Never trigger Full roster sync during recovery unless vendor support explicitly requests it and one gate is tested first.
- Rotate all VPS, database, dashboard, and API credentials shared in chat after the incident; they are now exposed and must not remain active.

## Technical scope

Likely changes are limited to the shared MIPS dispatcher, sync worker, face sweep, reconciliation worker, access worker, dispatch-state RPC/constraint, automation rules, and operational diagnostics. No membership, payroll, billing, or attendance calculations will be changed.
