# Fix wrong attendance times after the network outage

## What we found today (checked live)

- **Gate and server clocks are correct.** Live scans reach us within a minute of the time the gate records, so neither the device nor the MIPS server clock is off.
- **About 84 scans from roughly 6:30 AM to 10:00 AM** were held on the MIPS server during the outage and fetched by the backup poller at about 10:00 AM. The gate's own scan time (for example 07:42) was saved correctly in the raw scan log.
- **Member attendance used the catch-up time, not the scan time.** Every member check-in today has a check-in time equal to the moment it was saved. There are no member visits between 7 AM and 10 AM; they all show around 10:00–10:15 AM. Member attendance during the outage was recorded with the wrong time.
- Staff attendance already sends the real scan time, so it was not affected in the same way. This will be re-checked.

## The fix

1. **Use the real scan time for member check-in and check-out.** The backup poller passes the gate's scan time. The check-in step saves that time instead of "now". This only accepts times up to 48 hours old, never future times, and logs who/what supplied them.
2. **Repair today's records.** Match each of today's late-saved member visits to its raw scan and correct the check-in/check-out times. Merge duplicates, then re-run PT auto-attendance for the affected members so PT matching uses the real times. Each correction is written to the audit log with old time, new time and "outage backfill" as the reason.
3. **Clock drift guard.** On every poll, compare each gate's latest scan time with arrival time. If a gate is more than 5 minutes ahead, or its time is in the future, raise a Device Health alert ("Gate clock off by X min") in System Health. Do not reject the scan.
4. **Outage visibility.** When the poller recovers a batch older than 15 minutes, record a "backlog recovered" event with count and time span, shown on the Devices page.

## Verification

- Replay a held scan from 07:42 through the poller: member visit shows 07:42, not the poll time.
- Today's 7–10 AM visits appear in the correct hours on the attendance board, with no double counts.
- Live webhook path unchanged (scan saved within seconds, same time).
- Test: future or 3-day-old scan times are rejected and fall back safely with a logged warning.

## Technical notes

- Migration: add optional `p_check_in timestamptz` (and check-out equivalent) to `member_check_in`. Validate it inside the function, keep `rpc_guard_applies` guards, and keep execution limited to service role.
- `reconcile-mips-pass-records`: pass `normalizeScanTime(...)` into the member path (line ~430). `mips-webhook-receiver` passes hardware time too.
- One-off repair SQL via migration joined on `access_logs.payload->>'createTime'` (IST naive → `+05:30`) for 16 Oct; audit rows in `audit_logs`.
- Drift check writes through `log_error_event` (fingerprint per device) plus `access_device_health_events`.
- Add a test for the time-acceptance window next to `scripts/tests`.
