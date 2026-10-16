# Missing check-out times and annual upgrade reminders

## 1. Missing check-out times (checked live)

Today 43 member visits were recorded, but only 4 have a check-out time. The exit gate sent 19 member scans:
- 7 closed a visit, but several show wrong lengths ("1 min visit"). They were matched against the late 10:05 AM entry times.
- 6 failed with "No open visit to close". During the outage the exit scan was replayed before its entry visit was saved.
- 6 were ignored as "too close to entry scan". This happened for the same reason: the entry time was wrong.

Now that today's entry times are corrected, these exits can be applied properly.

**Fix**
1. **Order-safe check-out:** if an exit scan arrives before its entry has been saved (common after an outage), keep it as a pending exit. Apply it as soon as the matching entry arrives, instead of dropping it. The "too close to entry" rule compares gate scan times only, never save times.
2. **Repair today:** replay today's 19 exit-gate scans in order against the corrected visits. Fill in the missing check-outs and fix the wrong visit lengths, with each change recorded in the audit log.
3. **Nightly safety check:** at the end of the day, any visit still open that has a later exit scan in the gate log gets its check-out filled in from that scan. Any still open after that are closed by the existing auto-close rule.

## 2. Annual upgrade (15-day) reminders (checked live)

- **WhatsApp is going out.** In the last 3 days: 8 members received it (6 delivered, 1 read, 1 sent). 3 were held back by Meta's marketing limits (code 131049). That isn't a template problem and they can't be forced through.
- **10 members are waiting** because they haven't reached Day 7 yet. They'll get it automatically from the daily 9 AM run.
- **Email never sends.** Promotional email isn't connected, so the upgrade flow only uses WhatsApp. An email service needs to be connected first (one-time setup, needs your approval for the provider).

**Actions**
1. Send a test of both the Day 7 and the Day 12 templates to Rajat Lekhari (+91 98876 01200) using sample savings figures, and report what Meta says about delivery.
2. Show the email status as "Email not set up" in the upgrade panel, so it doesn't look like emails are failing silently.
3. Optional: connect a marketing email service so the same reminders also go by email (needs your choice).

## Technical notes

- New `member_gate_check_out` behaviour: on no open visit, insert into a small `pending_gate_exits` table (service-role only). `member_check_in` consumes a pending exit later than `_at` for the same member/day.
- The proximity check uses `_at` against `check_in`.
- The repair replays `access_logs` rows from device role `exit` for 16 Oct by `captured_at`. Audit rows go in `audit_logs`.
- A daily cron rule in Automation Brain fills open visits from later exit-role `access_logs`.
- The test sends go through `dispatchCommunication` with the approved `annual_upgrade_day7` and `annual_upgrade_closing` templates.
