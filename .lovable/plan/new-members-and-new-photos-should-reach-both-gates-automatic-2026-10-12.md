# New members and new photos should reach both gates automatically

## What actually happened (checked today, member INC-26-0207)

| Time | Event |
|---|---|
| 12:39 | Member created, photo saved, gate job queued |
| 12:39–12:43 | **Nothing ran.** The queue is only checked every 15 minutes |
| 12:43 | You pushed manually, and both gates accepted |
| 12:45 | The 15-minute check ran, saw your push from 70 seconds earlier, skipped both gates as "cooldown", and recorded "0/2 gates delivered". The job stays stuck as pending |
| 12:48 | You re-uploaded the photo. 3 new jobs were queued |
| 12:49 | The new photo went to the gate server, but **was never sent to either gate** |

Right now 5 jobs for this one member are waiting in the queue.

## Three causes

1. **No immediate push at onboarding.** Saving a photo only adds a job to the queue. The queue is checked every 15 minutes, so the gates can wait up to 15 minutes. Staff push by hand instead of waiting.
2. **Cooldown counts as a failure.** If the person was sent to a gate in the last 3 minutes, the gate is skipped, and the job is marked "not delivered" even though it was. The job then stays stuck.
3. **A new photo looks like "no change".** The system skips a gate when the person "already looks the same". It decides this by comparing dates and the photo's file location. A re-uploaded photo is saved in the same place under the same name, so it looks unchanged. The server gets the new face, but the gates keep the old one.

## The fix

1. **Push right away.** When a member, staff member or trainer gets a new face photo, start the gate push within seconds instead of waiting for the 15-minute check. The 15-minute check stays as a backup.
2. **Treat a cooldown as delivered.** If a gate was skipped only because the same person was sent to it seconds earlier, count that gate as done and close the job.
3. **Combine duplicate jobs.** When several jobs are waiting for the same person, run one and close the rest, so one upload never sends the person 3–5 times.
4. **Detect new photos by content.** Compare the photo's fingerprint (it is already worked out and stored), not its file location. A new face is always sent to both gates. A repeat upload of the same picture is still skipped.
5. **Status in Devices → Personnel Sync:** show "Waiting for gate" or "On both gates" for each person, so you can see it worked without pushing by hand.
6. **Clear the stuck jobs** for INC-26-0207, then check both gates have the current photo.

The protections from the gate-restart fixes stay in place: one person per gate, a gap between pushes, the daily limit, and no full roster downloads.

## Technical details

- `sync-to-mips`: add `mips_photo_hash` to the state signature passed to `dispatchToDevices`. Push gates in the cooldown set to `deliveredDeviceIds` when the latest hot attempt is `success`. Bump the version.
- `process-biometric-sync-queue`: group pending rows by person, process the newest row, and mark sibling rows `succeeded` ("merged").
- New AFTER INSERT trigger on `biometric_sync_queue` calls `process-biometric-sync-queue` through `pg_net` for that person only (service role, idempotent). Leave the existing 15-minute rule unchanged.
- Personnel Sync tab: read `mips_dispatch_status` per person.
- Verify: re-upload a test photo, then confirm one `device_dispatch` success per gate within about a minute and an empty queue.
