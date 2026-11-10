# Contract signing: Signature first, then code

## What changes for the employee
The page becomes three numbered steps in this order:

1. **Read the contract**: unchanged. Scroll to the bottom to unlock step 2.
2. **Sign**: draw the signature and tick the consent box.
   - **Full legal name** is filled in from the contract (for example "Harshwardhan Chaturvedi") and shown as "Signing as …" with a small Edit link. It stays because the law and the PDF need a typed name next to the drawn signature. The person no longer has to type it.
   - **"Phone or email (optional)" is removed.** The code step already proves their phone or email, so this box was redundant.
   - A "Continue to verification" button unlocks only after a signature is drawn and consent is ticked.
3. **Verify and sign**: choose WhatsApp or Email (SMS stays hidden while it's switched off), enter the 6-digit code, then press "Verify & sign contract".
   - The drawn signature is kept while they wait for the code. "Back" returns to step 2 without clearing it.

## What stays the same
- Server checks are unchanged. The code is still required, and signing still stops if the signature upload fails.
- WhatsApp → email fallback, error messages and System Health logging stay as they are.

## Technical details
- Only `src/pages/ContractSign.tsx` changes:
  - add a `step` state with values `read | sign | verify`
  - prefill `signedName` from `contract.employee_name`
  - drop the `signerContact` input and send `signer_contact: null`
  - save the signature's data URL when continuing, so it survives re-renders
  - move the code block below the signature section
  - add an `aria-live` step heading and focus management on each step change
- No changes to the backend or the database.
- Check: Playwright on Harshwardhan's link at 375px and desktop, confirming the order is Read → Sign → Verify. No code is sent during the check.
