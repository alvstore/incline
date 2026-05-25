## Why the agreement currently shows blanks

The preamble template renders `Mr./Ms. ___`, `S/o / D/o ___`, `Email: -`, `Phone: -` from `src/lib/hrm/contractTemplateV2.ts` (lines 132–144). Each blank has its own root cause:

| Field in PDF | Source | Why it's blank today |
|---|---|---|
| `Mr./Ms. _______________________` | `employees.profiles.full_name` (via `resolveRecipient`) | Profile row has no `full_name` — staff was created without a linked profile or name was never filled in **Employees → Edit → Personal**. |
| `Email: -` / `Phone: -` | `profiles.email` / `profiles.phone` | Same profile is missing email/phone. |
| `S/o / D/o ___` | `contract_variables.father_or_husband_name` | Employee never opened the **Contract Fill** link (`/contract-fill/:token`) — that page is what writes `father_or_husband_name`, `residential_address`, `emergency_contact_*`, `pan_or_aadhaar_last4`, and witnesses. |
| `Residing at: ___` | `contract_variables.residential_address` | Same as above. |
| `Employee Code: EMP-MOZWZUNA` | `employees.employee_code` | This one *is* correct — proves the contract is wired to the right employee row. |

So two distinct gaps need to be closed:

1. **Profile data** — `full_name`, `email`, `phone` must exist on the `profiles` row before generating a contract.
2. **Self-fill variables** — the employee must complete the public Contract Fill link before signing. Until they do, the PDF falls back to underscores by design.

## Why we don't already share the roster's branded PDF format

The Staff Roster PDF is built **client-side with jsPDF** (`src/utils/pdfBlob.ts` → `buildStaffRosterPdf`) using a shared `header(doc, …)` / `footer(doc, …)` helper that reads `brand.logoUrl` from `organization_settings` and renders the Incline logo, address, GSTIN, page numbers, etc.

The Employment Agreement PDF is built **server-side in the `contract-signing` edge function with pdf-lib** (`supabase/functions/contract-signing/index.ts` lines 619–789). It has its own ad-hoc `drawHeader()` / `drawFooter()` that prints the legal name as text only — **no logo, no rounded card branding**, plus a giant `EMPLOYEE COPY` watermark.

We *can* and *should* reuse one brand language across both, but the contract PDF must keep running server-side, because:
- it embeds the typed/drawn signature image from a private storage bucket,
- it computes the `signed_pdf_hash` and persists it on `contracts.stamped_pdf_path`,
- the SHA-256 of `terms` must match `contract_signatures.terms_hash_at_sign` for tamper-evidence under IT Act §10A.

So the fix is: **extract a single branded layout module (logo, header, footer, watermark, typography) that both the roster PDF and the contract PDF call** — not move the contract PDF to the client.

## The plan

### 1. Shared branded PDF surface

- New file `supabase/functions/_shared/brandedPdf.ts` exporting:
  - `loadEmployerBrand(supabase, branchId)` — returns `{ legalName, address, phone, email, gstin, pan, regNo, logoBytes }` from `get_employer_profile` + `organization_settings.logo_url` (downloaded server-side, cached per cold start).
  - `drawBrandedHeader(page, pdfDoc, brand, opts)` — logo (left) + legal name + address + contact (center/left) + GSTIN/PAN block (right), matching the roster header proportions.
  - `drawBrandedFooter(page, brand, { pageNum, totalPages, refLabel, verifyUrl })`.
  - `drawWatermark(page, label)` — keep the diagonal `EMPLOYEE COPY` / `EMPLOYER COPY` / `ORIGINAL` / `DRAFT — NOT YET SIGNED`.
  - Shared color tokens (`INDIGO`, `SLATE_500`, `SLATE_900`) so both PDFs use one palette.
- New mirror in `src/utils/pdfBlob.ts`: refactor the existing jsPDF `header()` / `footer()` to consume the same tokens (purely cosmetic — same output, just shared constants in `src/lib/brand/pdfTokens.ts`).

### 2. Refactor `contract-signing` PDF builder

- Replace `drawHeader` / `drawFooter` in the edge function with the shared helpers above.
- Embed the logo PNG via `pdfDoc.embedPng(logoBytes)` and draw it at 28×28 next to the legal name.
- Move the body into a 2-column "Filled details" card matching the roster's card style (subtle slate divider lines, 10pt Helvetica, indigo section heads).
- Keep all signature / hash / watermark logic untouched.

### 3. Stop printing empty placeholder lines

In the preamble (`contractTemplateV2.ts` 132–144), only emit a line if the value is present. Replace the current pattern:

```text
Email: -
Phone: -
S/o / D/o __________________
Residing at: __________________
```

with conditional rendering: missing rows are skipped entirely, and the **Filled details** section already in the PDF (lines 720–742) becomes the single source for self-filled fields. The preamble keeps only the legally-required identity line(s) that *are* known.

When a field is genuinely required but absent at draft time, render `[Pending — to be filled by employee before signing]` in muted slate, never an underscore.

### 4. Close the data-gap UX in HRM

On the contracts list (`src/pages/HRM.tsx`):

- Before "Generate draft PDF" runs, run a one-shot guard: if `profiles.full_name / email / phone` are empty, open the Employee drawer pre-focused on the missing field instead of producing a blank-looking PDF.
- Add a row action **"Copy Fill Link"** + **"Send Fill Link via WhatsApp"** that re-sends the existing `/contract-fill/:token` URL through `dispatchCommunication()` (uses the existing `contract_signature_requests.token_hash`).
- Add a small status chip on each contract row: `Awaiting employee details` (cvars incomplete) → `Ready to sign` (cvars complete, signature pending) → `Signed`.
- On the **CreateContractDrawer** success toast, replace the current generic message with two CTAs: *"Open fill link"* and *"Send fill link to employee"*.

### 5. How the user fills the blanks today (immediate workaround)

Until step 4 ships, the founder can:

1. Open **Employees → that employee → Edit** and set `full_name`, `email`, `phone` on the profile.
2. Open **HRM → Contracts → … menu → Copy fill URL** and send `/contract-fill/<token>` to the employee on WhatsApp.
3. Employee opens link, fills S/o, address, emergency contact, PAN/Aadhaar last 4, witnesses → taps **Save**.
4. Regenerate the draft PDF — all fields now populate.

### Files touched

- `supabase/functions/_shared/brandedPdf.ts` *(new)*
- `supabase/functions/contract-signing/index.ts` *(swap header/footer, embed logo, drop empty preamble lines)*
- `src/lib/brand/pdfTokens.ts` *(new — shared color/typography constants)*
- `src/utils/pdfBlob.ts` *(consume shared tokens; no visual regression for roster)*
- `src/lib/hrm/contractTemplateV2.ts` *(conditional preamble, no underscores)*
- `src/pages/HRM.tsx` *(row chip, Copy/Send fill link, missing-profile guard)*
- `src/components/hrm/CreateContractDrawer.tsx` *(success CTAs)*

### Explicitly out of scope

- Moving contract PDF generation to the client.
- Changing the legal clause text or `CONTRACT_TEMPLATE_VERSION` (would invalidate existing `terms_hash`).
- Auto-OCRing PAN/Aadhaar to populate `pan_or_aadhaar_last4`.
