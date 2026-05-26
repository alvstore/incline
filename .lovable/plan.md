## Plan

### 1. Fix the contract signing duplicate-entry error
- Remove the obsolete unique index `contract_signature_requests_contract_role_uidx` that currently blocks every second link for the same contract + role, even after the old link is revoked.
- Keep the correct partial unique index `contract_signature_requests_open_unique`, which only prevents multiple open links for the same contract + role.
- Add a transactional database helper for creating signature requests:
  - lock the target contract row,
  - expire/revoke any existing open request for that role,
  - insert the new request,
  - return the request id and branch id.
- Update `supabase/functions/contract-signing/index.ts` to call this helper instead of doing separate revoke + insert calls, preventing race-condition duplicates from double clicks.
- Bump the function version and keep actionable logging via `log_error_event`.

### 2. Clean up the affected HRM records
- Verify the existing request for Ritesh Sharma’s contract.
- Ensure the stale revoked/expired request remains historical, and the next copy-link action creates a fresh valid link.
- Mark the specific System Health duplicate-entry log as resolved after the fix is verified.

### 3. Resolve active System Health errors that are real app issues
- Investigate and fix the open database errors shown in System Health:
  - `column reference "branch_id" is ambiguous`, likely from a branch-scoping SQL/RLS function or policy.
  - `Could not find a relationship between 'trainers' and 'profiles'`, by replacing any problematic implicit join with explicit profile lookups or the correct FK hint.
- Keep transient network/chunk-load errors out of scope unless they point to a reproducible code issue; those are usually deploy/network noise and should be filtered or marked resolved if already stale.

### 4. Verify
- Redeploy the updated `contract-signing` backend function.
- Test `create_link` for the same contract twice: the second attempt should return a new link, not a 500.
- Re-check `error_logs` and backend function logs for fresh failures.
- Confirm System Health no longer has new open errors for this contract signing flow.

## Technical notes
- Root cause confirmed: the database has two unique indexes on `contract_signature_requests`. The old full unique index on `(contract_id, role)` conflicts with the intended partial unique index and causes the screenshot error.
- The safest fix is both schema-level cleanup and transactional link creation, so the system remains safe even if a user clicks copy-link repeatedly.