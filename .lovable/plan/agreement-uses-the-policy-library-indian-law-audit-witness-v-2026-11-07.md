# Agreement uses the Policy Library + Indian-law audit + witness visibility

## What I found
- The employment agreement text is fully hardcoded (18 clauses + "Annexure A"). It never reads the Policy Library, even though the library already has 10 active policies (Code of Conduct, POSH, Leave & Attendance, DPDPA Privacy, Confidentiality, Health & Safety, IT use, Social media, Anti-bribery, Anti-discrimination), all v1 and applicable to every staff role.
- Several hardcoded clauses duplicate those policies (conduct, confidentiality, leave), so editing a policy changes nothing in the PDF.
- Witness picker code exists in the contract drawer and a "Contract witnesses" card at the bottom of HR Settings. It is easy to miss, and the live site only shows it after publishing. I'll check it in the preview to confirm.

## What I'll change

1. **Agreement pulls policies live**
   - When a contract is drafted, attach the latest active version of each policy that applies to the selected role (trainer/staff/manager) as "Annexure B – Company Policies", listing title, version and effective date, plus full text.
   - The contract saves which policy versions were included, so a signed PDF always shows what was agreed, even after a policy changes.
   - Shorten the hardcoded clauses that repeat policies (conduct details, leave rules, data handling) to one line: "governed by Policy X (Annexure B)". Keep the core legal terms in the agreement: appointment, salary, notice, termination, deductions, governing law, and the no-private-PT, no-market-supplements and no-money-borrowing rules.
   - Signing the agreement also records an acknowledgement for each attached policy, so the Policy Library's acknowledgement count updates automatically.
   - Drafts that are not signed yet are refreshed. Signed contracts are left untouched.

2. **Indian-law gap audit (added to the policies, editable afterward)**
   Check against: Shops & Establishments (Rajasthan), Code on Wages (timely pay, lawful deductions only), Payment of Gratuity, EPF/ESI, Maternity Benefit Act, POSH Act 2013 (Internal Committee details), DPDP Act 2023, Indian Contract Act s.27, Industrial Employment (Standing Orders) for disciplinary process, and a grievance procedure. Missing items, such as gratuity, maternity, the grievance and disciplinary procedure, and working hours/overtime per state law, become new or updated draft policies in the library for you to review before activating. These are not legal advice; a lawyer should review them.

3. **Witness UI easy to find**
   - Add a "Witnesses" section inside HRM (next to Policies) that uses the same saved-witness manager, with signature upload.
   - In the contract drawer, move the witness cards to the top of their own clearly labelled step, with an "Add witness" button that is always visible.
   - Accessibility: labelled buttons, keyboard-usable picker, and signature images with alt text.

4. **Analytics**: `contract_policies_attached` and `witness_created`, with no personal data.

## Verification
- Playwright on the preview as owner: open HRM, then Witnesses, and add a witness. Draft a trainer contract and confirm Annexure B lists only trainer-applicable policies at their current versions. Edit a policy, then confirm a new draft picks up v2 and the old signed one does not.
- Run the existing contract-signing tests and add a test for role-based policy selection.

## Technical details
- New column `contracts.policy_snapshot jsonb` (code, version, title, body hash). It is filled when a contract is drafted and frozen at signing.
- `contract-signing` function: build Annexure B from the snapshot. On signing, insert `policy_acknowledgements` rows.
- Policy selection: `is_active`, latest version per code, role in `applicable_roles`, branch match or global.
- Files: `employmentAgreementTemplate.ts`, `CreateContractDrawer.tsx`, `pages/HRM` tabs, new `WitnessesTab`, and `supabase/functions/contract-signing/*`.
