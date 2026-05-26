## Audit — why the PDF shows duplicates

The contract PDF has **two independent layers** writing the same fields:

1. **Terms body** (the markdown stored in `contracts.terms`) — currently hardcodes blank placeholder blocks:
   - `## SIGNATURES` with `Signature: ____________________` for Employer + Employee
   - `## WITNESSES` with `Witness 1 / Name: ____ / Signature: ____` and `Witness 2 / Name: ____ / Signature: ____`
   - `## ANNEXURE A (ROLE-SPECIFIC DETAILS)` bullet list

2. **PDF builder** in `supabase/functions/contract-signing/index.ts` (lines 778–820) appends, after the terms:
   - **"Filled details"** — pulls real values from `contract_variables` + prefill: S/o, address, emergency contact, PAN/Aadhaar, **Witness 1 (name + phone), Witness 2 (name + phone)**
   - **"Signatures (pending)" / "Signatures"** — actual employee signature image / typed name + date

Result on the rendered PDF (your screenshot):
- Witnesses appear **twice**: blank placeholder lines in `## WITNESSES`, then filled values under `Filled details`.
- Signatures appear **twice**: blank line in `## SIGNATURES`, then the real "Signatures (pending)" block.
- The "blank" copy looks like data is missing, even though it's actually captured.

The template lives in **two places** (both must be fixed to stay in sync):
- `src/components/hrm/CreateContractDrawer.tsx` — `buildDefaultTerms()` around lines 295–332 (the one currently used; matches your screenshot text "ANNEXURE A (ROLE-SPECIFIC DETAILS)").
- `src/lib/hrm/contractTemplateV2.ts` lines 393–432 — alternate builder; also has the duplicate blocks.

## Fix plan (UI/UX + PDF correctness only — no business-logic changes)

### 1. Strip the duplicate blocks from the terms template
In **both** `CreateContractDrawer.tsx::buildDefaultTerms` and `contractTemplateV2.ts`:

- **Remove** the `## SIGNATURES` block (Employer + Employee blank signature lines).
- **Remove** the `## WITNESSES` block (Witness 1 / Witness 2 blank lines).
- **Keep** `## ANNEXURE A (ROLE-SPECIFIC DETAILS)` — it's informational, not duplicated.
- End the terms body cleanly after the last legal clause + Annexure list.

The PDF builder already renders the canonical "Filled details" + "Signatures" sections — those become the single source of truth.

### 2. Tighten the PDF builder's appended sections for premium look
In `supabase/functions/contract-signing/index.ts`:

- Rename the appended "Filled details" header to **"Personal Details (provided by employee)"** for clarity.
- Add an explicit **"Witnesses"** sub-header right after personal details, listing Witness 1 / Witness 2 with name + phone (still pulled from `cvars`), so it reads like a proper section instead of two rows in a generic list.
- Keep the "Signatures (pending) / Signatures" block as-is — it's already the only signature renderer.
- When the employee has signed, replace the "(electronic — captured at signing)" placeholder (which currently only exists in `contractTemplateV2.ts`) with the real signature image already embedded below.

### 3. Backfill protection
Existing draft contracts already saved with the old terms text will still contain the duplicate blocks. To avoid editing historical legal text:

- Add a one-time **sanitiser** in the PDF builder that strips `## SIGNATURES … ---` and `## WITNESSES … ---` segments from the terms string **before** rendering. This way old + new contracts both render cleanly without mutating stored data.

### 4. Verify
- Generate a fresh contract via Create Contract drawer → confirm PDF has **one** witnesses section (under Personal Details) and **one** signatures block.
- Open an existing draft → confirm the sanitiser hides the legacy blocks too.
- Signed PDF (final) → confirm signature image renders once, witness rows show captured values, no blank `____` lines anywhere.

## Files to change

- `src/components/hrm/CreateContractDrawer.tsx` — trim `buildDefaultTerms()` (remove SIGNATURES + WITNESSES blocks)
- `src/lib/hrm/contractTemplateV2.ts` — same trim
- `supabase/functions/contract-signing/index.ts` — rename "Filled details" → "Personal Details", add "Witnesses" sub-header, add legacy sanitiser before rendering terms; bump version comment

## Out of scope
- Form fields, RPC contracts, signing flow, witness data capture (already works — values are in `cvars`).
- Branding / header / GSTIN block (unchanged).
- Other PDF templates (invoice, payslip).
