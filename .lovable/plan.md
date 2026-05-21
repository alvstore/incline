# HRM Cleanup: Single Source of Truth + Contract OTP + Hardened PDF

## Audit findings (why "Employer details" felt redundant)

The same data is being entered in **three places** today:

| Field | `branches` | `organization_settings` | `hr_settings` |
|---|---|---|---|
| Legal/brand name | ✓ `name` | ✓ `name` | ✗ duplicated as `employer_legal_name` |
| Address | ✓ `address`,`city`,`state`,`postal_code` | — | ✗ duplicated as `employer_registered_address` |
| GSTIN | ✓ `gstin` | — | ✗ duplicated as `employer_gstin` |
| Phone / Email | ✓ `phone`,`email` | — | — (missing on PDF today) |
| Logo | — | ✓ `logo_url` | ✗ unused `logo_storage_path` |
| PAN, Proprietor, Firm reg no, POSH IC, notice tiers, hours caps | — | — | ✓ (HR-only — correct home) |

Result: PDF currently prints a hardcoded "Sector 14, Udaipur" because nobody filled the duplicate fields in `hr_settings`, even though the same address is already saved on the branch.

And the Contracts tab `CreateContractDrawer` also re-asks for employer/role facts that the `employees` row + `hr_settings` already hold.

Contract Sign page (`/contract/sign/:token`) has **no OTP** today — anyone with the link can sign. The user asked us to add WhatsApp OTP and to drive it through the canonical Templates Hub (event catalog + `dispatchCommunication`), not as a one-off.

---

## Plan

### 1. One source of truth for employer details

**Drop the duplicated columns from `hr_settings`** and read from canonical tables:

- `employer_legal_name` → use `branches.name` (fallback `organization_settings.name` for global/HQ)
- `employer_registered_address` → composed from `branches.address, city, state, postal_code, country`
- `employer_gstin` → `branches.gstin`
- `employer_phone`, `employer_email` → `branches.phone`, `branches.email`
- `logo_url` → `organization_settings.logo_url`
- `logo_storage_path` → drop (unused)

**Keep in `hr_settings` (HR-only, no other home):**
PAN, proprietor name, firm registration no, POSH IC, lawyer review, tiered notice periods, hours caps, OT multiplier, Basic % of CTC, arbitration seat, governing jurisdiction, PT commission clawback flag.

**New helper** `src/lib/hrm/getEmployerProfile.ts` + RPC `get_employer_profile(branch_id)` → returns the merged object used by:
- `HrSettingsTab` (read-only "Pulled from branch" block + edit-pen that deep-links to Branch settings)
- `CreateContractDrawer` (preview block, no duplicated inputs)
- `generate-stamped-pdf` edge fn (header + signatory block)
- Payslip and GST invoice headers (already consume branches today — verify and unify)

Migration:
```sql
ALTER TABLE hr_settings
  DROP COLUMN employer_legal_name,
  DROP COLUMN employer_registered_address,
  DROP COLUMN employer_gstin,
  DROP COLUMN logo_storage_path;
-- keep employer_pan, employer_firm_registration_no, employer_proprietor_name
```
(Existing 2 rows have empty GSTIN/address so no data loss — verified.)

### 2. HR Settings tab — slimmer, no duplication

`HrSettingsTab.tsx` becomes 3 cards:
1. **Employer (from branch)** — read-only summary card pulled via `getEmployerProfile`, with a "Edit in Branch settings" link to `/branches`.
2. **Statutory & contractual defaults** (unchanged).
3. **POSH Internal Committee** (unchanged).

Delete the 6 employer input fields and the "Logo storage" column.

### 3. Contract Sign flow — WhatsApp OTP via canonical hub

Add a 2-step sign flow:
1. **Request OTP** — `POST contract-signing { action: 'request_otp' }` generates a 6-digit code, stores SHA-256 hash in new `contract_sign_otps` table (token + hash + expires_at + attempts), and dispatches through the **canonical pipeline**:
   - Adds two events to `src/lib/templates/systemEvents.ts`:
     - `contract_sign_otp` (WhatsApp + SMS + Email — channels chosen by member preferences)
     - `contract_signed_confirmation` (already-style confirmation with stamped PDF link)
   - Sends via `dispatchCommunication({ event: 'contract_sign_otp', vars: { name, otp, expires_in: '10 minutes', employer_name } })`. Quiet-hours/dedupe handled by dispatcher.
2. **Verify + Sign** — existing `contract-signing` POST gains `otp` field; validates hash, attempt cap (5), 10-minute window. On success runs the existing signature/geo/terms_hash insert.

`ContractSign.tsx`: insert an OTP step before the signature canvas (resend with 30s cooldown, mask phone, paste-friendly input).

Templates: re-run AI Drawer for the two new events so WhatsApp/SMS/Email templates auto-seed (existing `ai-generate-whatsapp-templates` flow — no new code path).

### 4. Contracts tab cleanup

`CreateContractDrawer`: remove any employer name/address/GSTIN inputs (currently asks via hr_settings indirectly). Show a compact "Issuing from: {branch name} • GSTIN {…}" header instead. All other fields (role, salary, dates) untouched.

`PoliciesTab` + Contracts list: no schema change, just confirm both call `getEmployerProfile` for any header rendering.

### 5. Hardened PDF (`generate-stamped-pdf`)

- Pull employer block from `getEmployerProfile(contract.branch_id)` instead of hr_settings columns.
- Header: logo (from `organization_settings.logo_url`), legal name, full address line, GSTIN, phone, email.
- Add missing fields visible in the reference PDF: contract reference no., place of execution, witness signature blocks rendered from the stored `witness_1/2` rows, footer "For {employer_legal_name} — Proprietor: {employer_proprietor_name}" with signature image, page numbers, QR verify code, "Original / Employee Copy / Employer Copy" watermark (already present — keep).
- Tamper-evident footer line: `terms_hash` short + `signed_at IST`.

### 6. Delete-list (one source of truth enforcement)

- `hr_settings.employer_legal_name` / `employer_registered_address` / `employer_gstin` / `logo_storage_path` columns
- Employer input fields in `HrSettingsTab`
- Any employer name/GST inputs in `CreateContractDrawer`
- Hardcoded "Sector 14, Udaipur…" fallback in `generate-stamped-pdf`

### Technical detail

Files touched:
- **Migration**: drop 4 columns; create `contract_sign_otps` table with RLS (member can insert via edge fn only, no SELECT); create RPC `get_employer_profile(branch_id uuid)` returning JSON merge of `branches` + `organization_settings` + `hr_settings`.
- **New**: `src/lib/hrm/getEmployerProfile.ts`, `src/lib/hrm/EmployerSummaryCard.tsx`.
- **Edit**: `src/components/hrm/HrSettingsTab.tsx`, `src/components/hrm/CreateContractDrawer.tsx`, `src/pages/ContractSign.tsx`, `supabase/functions/contract-signing/index.ts`, `supabase/functions/generate-stamped-pdf/index.ts`, `src/lib/templates/systemEvents.ts`.
- **Memory**: update `mem://features/hrm-contracts-v2-evidentiary-signing` with the new source-of-truth + OTP rule.

### Open questions before I build

1. **OTP channel priority** — WhatsApp first, SMS fallback, Email last (mirroring existing dispatcher behavior). OK?
2. **PAN / proprietor name** are currently in `hr_settings` (HR-only). Should I instead surface them on the Branch page so all "employer identity" lives in one place? My recommendation: keep PAN/proprietor in `hr_settings` because they're HR-specific (statutory employer identity) while branch-level GSTIN is per-location billing identity.
3. Confirm I should hard-drop the 4 duplicated columns (data check shows the existing 2 rows are empty so no loss).
