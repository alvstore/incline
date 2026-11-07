# Contract witnesses — saved witness list with signatures, no re-entry on the signing link

## Audit findings (confirmed on live data)
- Witness names you type in the Create Contract drawer **are saved** on the contract (all 5 recent drafts have "RAJAT LEKHARI" as Witness 1).
- But the employee **signing page ignores them**: its Witness 1 / Witness 2 boxes always start empty, and whatever the employee types (or leaves blank) is sent at signing. That is why trainers/staff are asked for witness details again.
- Witnesses have **no signature** anywhere — the PDF only prints name and phone.
- Your current draft (and the 4 older test drafts) still have the old contract text from before the role/notice fix.

## What will change

### 1. Saved witnesses (reusable, with signature)
- New **Witnesses** list in HR settings (and openable from the contract drawer): add a witness with **name, mobile, designation (optional), and signature** — draw it on screen or upload an image.
- Witnesses belong to a branch, can be edited or switched off, and only owner/admin/manager can manage them.
- Signatures are stored privately and only shown through short-lived links.

### 2. Choose witnesses in the contract drawer
- Witness 1 and Witness 2 become pickers: choose a saved witness (shows name, mobile, signature preview), or **"+ Add new witness"** which opens the add form and saves it to the list for next time.
- You can still type a one-off witness without a signature if needed.
- The same witness can't be picked twice, and the employee can't be their own witness.

### 3. Signing link no longer asks for witnesses
- When witnesses were chosen in the drawer, the employee's fill and sign pages show them read-only ("Witnessed by Rajat Lekhari · +91…") instead of empty boxes.
- The server takes witness details from the contract, never from what the employee submits, so they can't be changed or wiped at signing.
- Witness fields are no longer "required" for the employee; if no witness was set, the manager gets a reminder to add them before the PDF is final.

### 4. PDF shows witness signatures
- Witness section prints each witness's name, mobile and **signature image** next to the employee and employer signatures, on both draft and signed PDFs.

### 5. Backfill your drafts
- All existing **draft** contracts get the new contract text (role-only duties, saved notice days, conduct rules), keeping their role, salary, commission and filled details.
- "RAJAT LEKHARI" is added to the saved witness list, and drafts that already name him are linked to that entry. You will need to add his signature once, after which it prints on every contract.
- Signed contracts are not touched. Every change is logged in the audit history.

## Technical details
- New table `contract_witnesses` (id, branch_id, full_name, phone, designation, signature_path, is_active, created_by, timestamps) with GRANTs, RLS (branch-scoped manage for owner/admin/manager via `(SELECT …)` helpers), and audit trigger. Private storage bucket `witness-signatures`, with storage policies matching `branch_id/` prefix paths.
- `contracts.contract_variables` gains `witness_1_id` / `witness_2_id`, and the drawer fills `witness_N_name/phone` from the picked row.
- `contract-signing` (v5.7.0):
  - `get_contract` returns locked witness info.
  - `sign_contract` ignores body `witness_1/2` and builds them from saved variables/witness rows.
  - Witness keys are removed from `REQUIRED_BEFORE_SIGN` and the employee allowlist.
  - The PDF builder embeds signature PNGs (downloaded with the service role) in the witness block.
- `ContractSign.tsx` / `ContractFill.tsx`: witness inputs are replaced by a read-only summary when they are preset.
- New `WitnessPickerField` + `WitnessSheet` (right-side Sheet, signature pad/upload, PhoneInput +91).
- Backfill via a one-off script: regenerate `terms.conditions` for `status='draft'` using `employmentAgreementTemplate.ts` and each contract's role/salary/commission/notice, write `CONTRACT_TERMS_BACKFILLED` audit rows, and link the existing witness names.
- Tests: the signing request can't override witnesses, a preset witness isn't required from the employee, and the backfill keeps salary/role.
