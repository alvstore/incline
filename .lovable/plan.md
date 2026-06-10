# Security Hardening — PII & Secret Exposure Fix

Branch managers still need to manage staff/trainers/skills, so we keep their operational access but strip them (and staff) from reading **sensitive columns** by routing reads through safe views and revoking direct column SELECT privileges. RLS row-rules stay; column GRANTs do the column-level work (Postgres-native, RLS-compatible).

## Pattern (applied per table)

```text
base table:  REVOKE SELECT on sensitive cols from authenticated
             GRANT SELECT (safe cols only) to authenticated
             keep existing UPDATE/INSERT/DELETE RLS so managers can still edit
safe view:   public.<table>_safe  (security_invoker=on, excludes sensitive cols)
             GRANT SELECT to authenticated
admin view:  public.<table>_admin (owner/admin only via RLS-equivalent SECURITY DEFINER fn or policy)
client code: switch list/detail reads to *_safe view
```

## Per-finding fixes

### 1. `employees` — PAN, Aadhaar, bank, UAN, ESIC, salary, tax_id
- Revoke `SELECT` on: `pan_number, aadhaar_last4, aadhaar_hash, bank_account, bank_ifsc, bank_name, uan_number, esic_ip_number, salary, tax_id, emergency_contact` from `authenticated`.
- Re-grant column SELECT on the remaining (safe) columns to `authenticated`.
- Create `employees_safe` view (excludes the above) for manager/staff reads.
- Create `employees_sensitive` view restricted via policy `has_any_role(owner|admin)` for HR/payroll screens.
- Update services: `hrmService`, payroll, employee list/detail UI → read from `employees_safe`; payroll/HR settings owner screens → `employees_sensitive`.

### 2. `contracts` — salary, base_salary, commission_percentage, terms, contract_variables
- Same pattern. Manager keeps row visibility for non-financial fields (title, dates, status, signature meta).
- `contracts_safe` (no $ columns) for branch HR ops; `contracts_financial` view owner/admin only.
- Update contract list/detail components.

### 3. `hr_settings` — employer_pan, employer_firm_registration_no, posh_ic
- Drop manager from `hr_settings_staff_read` SELECT.
- Add `hr_settings_safe` view (no PAN / registration / POSH committee personal details) for manager read of operational settings (leave types, work hours, etc.).
- Owner/admin-only policy for full row.

### 4. `mips_connections` — plaintext passwords
- Move secret → Supabase Vault (`vault.secrets`) keyed by `branch_id`.
- Add `vault_secret_id uuid` column to `mips_connections`; backfill by writing existing `password` to vault then NULL the column.
- `DROP COLUMN password`. Keep `mips_connections_safe` view (already used in UI) for read.
- Update `mips-proxy` edge function to fetch password via `vault.decrypted_secrets` (service role).
- UI (`AddDeviceDrawer`, `MIPSConnectionCard`) already writes via service / never reads password back — keep "leave blank to keep" UX, write path now upserts into vault.

### 5. `otp_verifications` — missing INSERT policy
- Explicit `CREATE POLICY otp_insert_service_only ON otp_verifications FOR INSERT TO authenticated WITH CHECK (false);` (and same for `anon`).
- Service role bypasses RLS, so edge functions continue to work.

### 6. `payment_transactions` — gateway_signature, webhook_data, response_body
- Revoke SELECT of those 3 columns + `gateway_payment_id`, `gateway_order_id` from manager/staff.
- `payment_transactions_safe` view exposes amount, status, method, member_id, branch_id, created_at, reference_id.
- Reconciliation/admin screens → owner/admin-only view `payment_transactions_admin`.

### 7. `profiles` — government_id_number, government_id_type
- Revoke SELECT of those 2 cols from manager/staff/trainer.
- Existing `profiles` SELECT policy unchanged for other cols.
- Owner/admin can read full row.

### 8. `trainers` — government_id_number, government_id_type
- Same column REVOKE pattern. `trainers_safe` excludes gov IDs.
- Update `Trainers.tsx`, trainer list/detail, scheduling components to read `trainers_safe`.

### 9. `campaign_recipients` — phone/email
- Drop phone/email columns from manager/staff column GRANTs (keep `id, campaign_id, member_id/lead_id, status, sent_at, error`).
- For send/audit visibility, resolve phone/email at send-time inside edge fn (service role). UI shows masked phone (last 4 digits) via SQL function `mask_phone()` in `campaign_recipients_safe`.

### 10. (Warn) `contacts`, `leads` — add role check
- `contacts_select_staff` → add `has_any_role(manager|staff|owner|admin)`.
- `leads` policies: revoke SELECT on `comm_consent_ip, comm_consent_user_agent` from manager/staff (owner/admin only).

## Migration order (single migration file)

```text
1. Create vault entries + mips_connections schema swap
2. Column REVOKE/GRANTs (employees, contracts, hr_settings, payment_transactions, profiles, trainers, campaign_recipients, leads)
3. Create *_safe and *_sensitive views (security_invoker=on)
4. GRANT SELECT on views to authenticated; tighten sensitive views with policies or wrapping security-definer fn
5. otp_verifications explicit INSERT deny policies
6. contacts policy role check
```

## Code touch-list (after migration runs & types regenerate)

- `src/services/hrmService.ts`, employee list/detail pages → `employees_safe`
- Contract list components → `contracts_safe`
- Trainer pages (`Trainers.tsx`, schedule pickers) → `trainers_safe`
- Payment list / reconciliation UI → `payment_transactions_safe`
- Campaign recipients UI (Campaigns page detail) → `campaign_recipients_safe`
- HR settings page → `hr_settings_safe` for managers; admin tab uses base table
- Profiles consumers (member/staff directory) → drop gov_id from selects
- `mips-proxy` edge fn → vault read
- `AddDeviceDrawer` / `MIPSConnectionCard` write paths → unchanged UX, server stores in vault

## Verification

- Re-run security scan; all 9 critical findings expected to clear.
- Manual role checks: manager session — cannot SELECT salary/PAN/gov_id/gateway_signature/password (returns null/permission denied); can still UPDATE allowed columns.
- OTP table: anon/auth INSERT returns 42501; service role still works.
- MIPS proxy still connects (vault path).
- `supabase--linter` clean.

## Out of scope

- Realtime members channel scoping warning (separate task).
- Public membership_plans / announcements visibility (intentional per business rules — will mark ignored with rationale).
- Refactoring existing role model.

Approve to proceed; I'll ship one migration + the code switches in a single build pass.
