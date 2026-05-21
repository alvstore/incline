# Contract Drawer + Sign Flow Cleanup

## Problems (from audit)

1. **Commission % is hardcoded to `10`** in `CreateContractDrawer`. Trainers already store `pt_share_percentage` (default 40) on `trainers` table — that's the source of truth. Manager has to retype it every time and can silently drift from the trainer's actual rate.

2. **T&C section shows a giant read-only "preview"** of the rendered template instead of *collecting the variables that are still missing* (S/o-D/o, residential address, witness names, employee photo/PAN, emergency contact, etc.). The full document should be assembled on the backend at PDF time — the drawer should only collect *unknowns*.

3. **No public role-scoped fill route.** When a manager creates a contract, the employee currently can only sign — there's no clean path for them to fill *their* missing fields (address, S/o-D/o, witnesses) before signing, and no path for an Owner to fill Owner-only fields without re-opening the drawer.

4. **Contracts table action column is duplicated:**
   - `Eye` (preview), `Printer` (print), `Download` (download) — **all three call the exact same `openContractPdf(contract)`**. One button is enough.
   - For signed contracts: "View Signed" (opens viewer modal) + "Stamped PDF" (downloads stamped copy) both do the same conceptual job. Collapse into one primary + overflow.
   - No "Edit", "Resend link", "Cancel/Void" actions — but a back-link / breadcrumb is missing on `ContractSign`.

## Plan

### A. Auto-fetch trainer commission (single source of truth)

- In `CreateContractDrawer` when `agreementRole === 'trainer'` and `employee.staff_type === 'trainer'`: seed `commissionPercentage` from `trainers.pt_share_percentage` (fetch in the existing `useEffect` that already queries the linked record). Fallback to 40 (the column default), not 10.
- Make the input **read-only by default** with an "Override for this contract" toggle (audit-logged). Show helper text: *"Synced from trainer profile (40%). Update in Trainers → Profile to change globally."*
- When `defaultRole === 'trainer'` but the record is from `employees` table (dual-role), look up the matching trainer row by `user_id` and pull `pt_share_percentage` from there.

### B. Replace T&C "preview" with a Missing Fields collector

- Remove the 16-row `<Textarea>` preview entirely from the drawer.
- Replace with a compact **"Contract Variables"** card listing only fields the template needs that aren't already known from employer profile / employee profile / trainer profile:
  - **Always-missing today:** `father_or_husband_name` (S/o, D/o), `residential_address`, `emergency_contact_name`, `emergency_contact_phone`, `pan_or_aadhaar_last4`, `witness_1_name`, `witness_2_name`, `probation_months`, `notice_period_days` (prefilled from `hr_settings.notice_period_*`).
  - Show each with a green ✓ if already known (from profile/branch/hr_settings), red • if missing.
- Store all variables in a new JSONB column on `contracts.contract_variables` (migration). The full document is rendered server-side at PDF time by `contract-signing` using `contractTemplateV2.ts` + variables + employer profile.
- Keep the "Unlock Legal Clauses" switch but move it to an **Advanced** disclosure that, when toggled, lets owner/admin override specific clause blocks (stored as `contract_variables.legal_overrides`). No more free-text Markdown editing for managers.

### C. Public role-scoped fill route

- New page `src/pages/ContractFill.tsx` at public route `/contract/:token/fill` (no auth, token-gated like `/contract/:token/sign`).
- The same `contract_sign_otps` / `otp_verifications` token flow gates access. After OTP verify, the page shows **only the fields assigned to that role**:
  - **Employee fields:** father/husband name, residential address, emergency contact, PAN/Aadhaar last 4, photo upload.
  - **Witness fields:** witness name + signature canvas (separate token + role=`witness` on the request, so a witness can be invited via a separate link).
  - **Owner/HR fields:** any clause overrides, witness pre-fill.
- Backend: extend `contract-signing` edge fn with `action: 'fill_fields'` that:
  - validates token + OTP
  - validates submitted keys against an allowlist per role (`EMPLOYEE_FILLABLE`, `WITNESS_FILLABLE`, `HR_FILLABLE`)
  - merges into `contracts.contract_variables`
  - logs audit row per field
- After all required fields are present, the existing `sign_contract` action becomes available — otherwise it returns `{ error: 'fields_incomplete', missing: [...] }` and the UI redirects to `/contract/:token/fill` first.
- DB: add `contract_signature_requests.role text` (one of `employee` | `witness_1` | `witness_2` | `hr`) and allow multiple rows per contract (for witnesses).

### D. Action button audit & dedupe

In `src/pages/HRM.tsx` Contracts table action column:
- **Collapse** Eye + Printer + Download into a single `Preview / Download` button (Eye icon, opens PDF in new tab — the browser already exposes print/save).
- **Unsigned contracts:** keep only `Preview` + `Copy Sign Link` (new — copies to clipboard) + overflow `…` menu with `Resend OTP (WhatsApp/SMS/Email)`, `Void contract`.
- **Signed contracts:** primary `View Signed` button + overflow `…` menu with `Download Stamped PDF`, `Download Witness Copy`, `Re-issue (clone)`.
- **Uploaded document** badge (paperclip) only shows if `document_url` is set — no separate button.

On `src/pages/ContractSign.tsx`:
- Add a top-bar with employer logo (left) and a single `← Back to portal` link only when the visitor is an authenticated member/staff; on public OTP flow show nothing on left to avoid leaking nav.
- Remove any duplicate "Cancel" links inside steps (keep one in footer).

### E. Files

**Edit**
- `src/components/hrm/CreateContractDrawer.tsx` — auto-fetch commission, remove T&C preview, add Missing Fields collector, Advanced legal overrides.
- `src/pages/HRM.tsx` — dedupe action buttons into Preview + overflow menu.
- `src/pages/ContractSign.tsx` — header cleanup, redirect to `/fill` when fields incomplete.
- `supabase/functions/contract-signing/index.ts` — add `action: 'fill_fields'`, per-role allowlist, fields-incomplete gating on `sign_contract`, server-side template rendering using `contract_variables`.

**Create**
- `src/pages/ContractFill.tsx` — public role-scoped fill page.
- `src/lib/hrm/contractVariables.ts` — canonical variable registry + per-role allowlists + `computeMissingVariables(contract, employee, employer)` helper, shared by drawer and edge fn.
- Route entry in `src/App.tsx` for `/contract/:token/fill`.

**Migration**
- `contracts` add `contract_variables jsonb default '{}'::jsonb`.
- `contract_signature_requests` add `role text default 'employee'`, drop unique-per-contract constraint if present.

## Technical Notes

- `pt_share_percentage` is `numeric` with default 40 (verified). The drawer's current default of 10 is wrong.
- The 3 buttons at lines 632–655 of `HRM.tsx` literally all invoke `openContractPdf(contract)` — pure dead duplication.
- Server-side template rendering means the legal text never has to travel through the client form — eliminates the "lock/unlock" UX wart for the 99% case.
- All new client → edge invocations stay within the existing `contract-signing` router; no new edge fn.
