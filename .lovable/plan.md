# Repair MIPS face verification truth

## Confirmed diagnosis

- The per-gate enrolment ledger currently records **94 enrolled people on Gate 1 and 94 on Entry 2**; there are no pending, missing, or rejected ledger rows.
- The branch has **100 members**, **99 linked MIPS person IDs/SNs**, and **94 CRM biometric photos**.
- Recent person syncs and photo uploads are succeeding and dispatching to both mapped devices.
- The Personnel Sync screen calls the MIPS person-list helper without the selected branch. That helper therefore omits `branch_id` from every paginated verification request.
- Recent proxy logs confirm two paths are running: valid branch-scoped requests use `http://212.38.94.228:9000`, while unscoped verification requests fall back to `212.38.94.228:9000` and fail as an invalid URL. The empty result is then rendered as `0/100`, `Not on server`, and `Missing` even though the people and faces exist.

## Implementation

1. **Make verification branch-scoped end to end**
   - Add `branchId` to the complete MIPS roster fetch and pass it through every page request.
   - Use the selected branch for initial server truth, periodic refresh, Verify All, and individual verification.
   - Include the branch in query keys so cached results cannot leak between “All branches” and a selected branch.

2. **Normalize and match MIPS identities reliably**
   - Use one canonical person-SN normalizer for CRM codes and MIPS responses: trim, remove separators, and compare case-insensitively.
   - Prefer the stored `mips_person_sn` when available instead of reconstructing every identifier from the display code.
   - Interpret MIPS photo flags explicitly so string values such as `"0"` are not treated as a valid face merely because they are non-empty.

3. **Prevent false empty states**
   - Distinguish “MIPS roster request failed” from a genuine empty roster; do not replace the last verified data with zero counts after a transport/configuration error.
   - Surface a compact retry/error state in Personnel Sync and disable bulk sync decisions while server truth is unavailable, preventing unnecessary re-syncs of already-enrolled people.
   - Keep the existing per-gate ledger as the authoritative gate-enrolment signal and label server presence separately from gate face enrolment.

4. **Repair stale CRM sync presentation**
   - When a live MIPS lookup confirms the same stored SN/person ID, display it as verified even if an old `mips_sync_status='failed'` remains from a previous attempt.
   - Reconcile stale failed statuses only for exact identity matches; leave the single genuinely unlinked member actionable.

5. **Harden the proxy fallback**
   - Normalize configured/fallback MIPS server URLs before use so a missing scheme cannot produce `Invalid URL`.
   - Keep branch database configuration as the primary source and preserve credential-scoped token caching.

## Validation

- Test a known linked member through individual Verify and confirm the exact MIPS person ID and face state.
- Run Verify All and confirm the UI reports the real server roster rather than `0/100`.
- Confirm Gate 1 and Entry 2 remain at 94 enrolled entries and no unnecessary resync is triggered.
- Verify selected-branch and all-branch cache isolation, error-state behavior, and photo-flag parsing (`0`, `1`, false, true, null, URL).
- Check recent proxy, sync, parity, and sweep logs after the change for valid URLs and successful person-list pagination.

## Technical scope

- Frontend service and Personnel Sync query/matching logic.
- MIPS proxy URL normalization and focused verification tests.
- No destructive face deletion, blanket re-enrolment, or device reset.
