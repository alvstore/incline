## Live Access Feed Recovery Plan

### Confirmed current state
- `access_logs` is empty: `0` rows, so the CRM has no persisted turnstile events to show.
- MIPS connection exists and is active for the main branch.
- Today’s member attendance table has rows, but the live access log table has none, which means attendance and access-feed persistence are currently split.
- `mips-proxy` has recently called `/through/record/list`, but a direct unauthenticated curl returns `401`, so testing/import needs to run through authenticated app/function context.
- `mips-webhook-receiver` has no recent logs, so the hardware webhook URL is not currently landing in the receiver.

### Implementation
1. **Create a backend reconciliation function for MIPS records**
   - Add/update an edge function such as `reconcile-mips-pass-records`.
   - It will authenticate to the configured MIPS server, fetch `/through/record/list`, normalize each pass record, resolve the person by MIPS SN / person ID / member or employee code, and insert missing rows into `access_logs`.
   - It will also call the existing member/staff attendance RPC logic where safe, so access events automatically become attendance records.
   - Use idempotent dedupe so repeated polling never creates duplicates.

2. **Make Live Access Feed database-backed first**
   - Update `LiveAccessLog.tsx` so refresh triggers the reconciliation function before reloading `access_logs`.
   - Keep direct MIPS polling as a visible fallback, but persist fetched MIPS records into `access_logs` instead of only displaying volatile client-side rows.
   - Replace the misleading `LiveMIPS · 0` empty state with an actionable status: last import time, imported count, skipped count, and error message when MIPS cannot be reached.

3. **Add automatic background sync**
   - Add a scheduled automation/cron path to run the reconciliation every 1–5 minutes.
   - This ensures turnstile scans are captured even when the dashboard page is closed.

4. **Repair hardware webhook path separately, without relying on it**
   - Keep `mips-webhook-receiver` as the instant path when the device callback works.
   - Use the MIPS record reconciliation as the mandatory fallback/source of truth so attendance is still recorded even if the Recognition Record Upload URL is misconfigured or blocked.

5. **Improve observability**
   - Log import attempts into existing diagnostics/error logging.
   - Show the latest imported MIPS record timestamp and the latest database access log timestamp in the Device Command Center.

### Verification
- Curl the backend reconciliation function and confirm it fetches records from MIPS.
- Confirm recent MIPS pass records are inserted into `access_logs`.
- Confirm the Live Access Feed changes from `MIPS · 0` to the latest turnstile rows.
- Confirm repeat runs do not duplicate rows.
- Confirm attendance tables are updated for recognized members/staff.

### Scope guard
- I will not change unrelated MIPS personnel sync, RCS, payments, or member profile flows in this fix.