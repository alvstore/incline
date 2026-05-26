## Audit — two stale-template bugs on page 1 of the contract PDF

### Issue 1 — "Commission %: _______%" never gets filled
`getEmploymentAgreementTemplate()` in `CreateContractDrawer.tsx` (line 160) hardcodes the placeholder:
```
* Commission %: _______%
```
The function doesn't accept the commission value at all, and the terms string is generated **once** at drawer-open and only re-generated when `agreementRole / employeeName / salary / startDate` change — never when the user edits the Commission % field. So even though the form captures `commissionPercentage` (default 10% for trainers) and saves it to `contracts.commission_percentage`, the rendered terms stay blank.

Same issue affects non-trainers: the whole "PT Commission" sub-block renders for Sales/Manager roles where it doesn't apply, with a meaningless blank %.

### Issue 2 — "see 'Filled details' section below" stub line shows even after employee filled
Lines 80–82 of the same file inject:
```
Personal details (S/o · D/o, residential address, emergency contact, ID):
see "Filled details" section below — completed by employee via the secure fill link.
```
Two problems:
- The pointer text says **"Filled details"**, but the PDF builder section was renamed to **"Personal Details (provided by employee)"** in the last patch — so the pointer points to a section name that no longer exists.
- When the employee has already filled their details, the page-1 stub still reads like data is missing, even though the values appear correctly in the dedicated section appended further down.

## Fix plan (template + edge-fn only, no schema changes)

### A. CreateContractDrawer template — `getEmploymentAgreementTemplate`

1. **Add params** `commissionPercentage: number` and surface `isTrainer` via the existing `role` arg.
2. Inside the PT Commission sub-section:
   - If `role !== 'trainer'` → **omit the entire `### PERSONAL TRAINING (PT) COMMISSION` block** (don't render section 5's PT bullets at all for staff/manager).
   - If `role === 'trainer'` and `commissionPercentage > 0` → render `* Commission %: 10%` (real value).
   - If `role === 'trainer'` and `commissionPercentage` is 0/empty → render `* Commission %: [to be agreed in Annexure A]`.
3. **Rewrite the page-1 personal-details stub line** so it matches the renamed downstream section and reads naturally:
   ```
   Personal details (parentage, residential address, emergency contact, ID) — provided by the Employee via the secure fill link and listed in the "Personal Details" section of this Agreement.
   ```
   No underscores, no broken "Filled details" reference.

4. **Add a useEffect** that regenerates `formData.terms` whenever `formData.salary`, `formData.commissionPercentage`, `formData.agreementRole`, or `formData.startDate` change — **gated on `!legalTermsUnlocked`** so manual edits are never clobbered. This keeps the live preview and the persisted terms in sync with the form fields.

5. **Update all 6 existing call sites** of `getEmploymentAgreementTemplate(...)` to pass the new `commissionPercentage` arg (default to current `formData.commissionPercentage`, falling back to 10 for trainers / 0 otherwise as the rest of the code already does).

### B. PDF builder — `supabase/functions/contract-signing/index.ts` (legacy safety net)

For draft contracts already saved with the old `_______%` placeholder, add a small render-time substitution **right after the existing terms sanitiser**:
- If `contract.commission_percentage` is a positive number and the terms contain `Commission %: _______%`, replace with `Commission %: <value>%`.
- If `contract.commission_percentage` is 0 or null, replace with `Commission %: [to be agreed in Annexure A]`.

Also strip the legacy `Personal details (S/o · D/o, residential address, emergency contact, ID): see "Filled details" section below …` pointer line from old terms when `cvars.father_or_husband_name` (or any personal detail) is populated — those values are already rendered in the appended "Personal Details" section, so the pointer is redundant and misleading on signed PDFs.

Bump the version comment to `v5.5.0` and keep the rest of the file unchanged.

### C. Verify
- Create a new Trainer contract with 12% commission → PDF section 5 reads `Commission %: 12%`, no `_______`.
- Create a Sales/Manager contract → PDF section 5 has **no** PT Commission sub-block (only Fixed Salary + Payment cycle).
- Page 1 AND block shows the new natural personal-details line — no "Filled details" wording, no blank lines.
- Open Ritesh Sharma's existing draft and regenerate PDF → the sanitiser fills in the commission % from `contracts.commission_percentage` and removes the stub pointer line because cvars are populated.
- Manually unlock + edit terms on a fresh contract → auto-regen does NOT overwrite the manual edits (legalTermsUnlocked gates it).

## Files to change
- `src/components/hrm/CreateContractDrawer.tsx` — template fn signature + PT block conditional + personal-details line rewrite + auto-regen useEffect + 6 call-site updates.
- `supabase/functions/contract-signing/index.ts` — extend terms sanitiser with commission-% backfill and personal-details stub stripper; version bump to v5.5.0.

## Out of scope
- Schema, RLS, RPC contracts (commission_percentage already exists on contracts).
- Annexure A salary breakdown layout (separate task if requested).
- Signature image rendering — already correct after last patch.
- Other PDFs (invoice, payslip, POS).
