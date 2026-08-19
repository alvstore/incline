# MIPS Sync Hardening & Real-time Enforcement Plan

The user reported that Jai Patel (INC260050) still has access until 2027 in the MIPS server despite having dues. Our audit reveals that while we have real-time triggers, the connection between the CRM, the MIPS Middleware (RuoYi-based), and the local device relays needs hardening to ensure "fail-closed" security.

## Problem Analysis
1.  **Stale `validTimeEnd`**: The MIPS Middleware stores a `validTimeEnd` date. If this isn't updated to `2000-01-01` (revoked) immediately when dues occur, the gate remains open.
2.  **Relay Logic**: The local gate relays (`mips-webhook-receiver`) might be trusting the device's local database or the Middleware's stale data instead of the CRM's real-time dues status.
3.  **Sync Lag**: Triggers that call `mips-access` might be failing silently or the `PUT /personInfo/person` call to MIPS might succeed but the `syncPerson` to devices might not be firing correctly.

## Proposed Enhancements

### 1. Hardened Real-time Enforcement
-   **CRM-to-Middleware**: Update the `evaluate_member_access_state` function to be even more aggressive.
-   **Middleware-to-Device**: Ensure `syncPerson` is called with high priority for all revocation events.
-   **Webhook Auth**: Hardened check-in logic in `mips-webhook-receiver` to perform a real-time dues check against `public.member_access_status()` and return an immediate `deny` signal to the relay.

### 2. Enhanced Workflow Architecture
-   **Atomic Revoke RPC**: A new server-side RPC `force_mips_revocation` that combines the DB state change and an immediate, non-blocking Edge Function call.
-   **Health Heartbeats**: Add a "MIPS Sync Health" check to the System Health dashboard to track failed sync attempts in `hardware_access_events`.

## Technical Implementation Details

### Database / RLS
-   Modify `evaluate_member_access_state` to explicitly check for the `mips_person_sn` and ensure the `hardware_access_events` record triggers the sync even if the status hasn't changed (to fix drift).
-   Update `public.member_access_status` to be more descriptive about *why* a member is blocked (e.g., distinguishing between "Expired Membership" and "Overdue Dues").

### Edge Functions
-   **`mips-access` (v2.7.0)**: 
    -   Add a `force_sync` flag to re-push the `validTimeEnd` even if the CRM thinks it's already revoked.
    -   Improve error reporting back to `access_logs`.
-   **`mips-webhook-receiver` (v2.4.0)**:
    -   Ensure `handleMemberCheckin` returns a terminal `member_denied` status if `member_access_status` returns `allowed: false`.
    -   The real-time block command `/api/command/deny` must be sent to the relay URL resolved from `mips_connections`.

### Memory Update (`mem://architecture/mips-connection-governance`)
-   Document the "Fail-Closed" requirement: The MIPS relay MUST query the CRM webhook for every scan, and the CRM MUST check dues in real-time.
-   Document the "Revocation Date": `2000-01-01 00:00:00` is the canonical revocation date for MIPS.

## Verification Plan
1.  **Simulate Dues**: Create an overdue invoice for a test member.
2.  **Verify Event**: Confirm `hardware_access_events` is inserted with `requires_sync = true`.
3.  **Verify Sync**: Check `access_logs` for a `hardware_revoke` event with `validTimeEnd=2000-01-01`.
4.  **Simulate Scan**: Mock a MIPS webhook call for the member and verify the response is `member_denied`.
