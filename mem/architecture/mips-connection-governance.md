---
name: MIPS Connection Governance
description: Rules for MIPS Middleware (RuoYi) and Device Relay synchronization.
type: feature
---
# MIPS Connection Governance

## Fail-Closed Enforcement
To ensure Jai Patel-style leaks (access despite dues) do not happen, the system enforces a multi-tier "Fail-Closed" architecture:

1.  **Real-time CRM Gate**: The `mips-webhook-receiver` MUST call `public.member_access_status()` for every scan. If `allowed` is false, it MUST return a `deny` signal to the relay regardless of the device's internal template date.
2.  **Middleware Revocation**: When `evaluate_member_access_state` detects dues (blocked_overdue), it pushes `validTimeEnd = '2000-01-01 00:00:00'` to the MIPS server.
3.  **Forced Revocation Date**: `2000-01-01` is the canonical revocation date. Never use null or past dates that are not this specific constant.
4.  **Hardware Dispatch**: Every revocation MUST be followed by a `syncPerson` call to all online `access_devices` in the branch to clear the local buffer.

## ID Resolution Hierarchy
MIPS Webhooks resolve identity in this priority:
1. `mips_person_sn` (exact string match from CRM sync)
2. `mips_person_id` (numeric ID from MIPS server)
3. `member_code` / `employee_code` (CRM primary keys)
4. `resolve_mips_person_alias` RPC (manual mapping for device-created faces)
