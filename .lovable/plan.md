# One Membership Registration & Agreement

Consolidate registration, waiver, terms, health declaration, PAR-Q and consents into a single document with a single signature, a single branded PDF, and one stored canonical record — used identically by public self-registration and the staff drawer.

## What's wrong today (verified in code)

- Two different documents exist for the same member: `onboarding-waiver.pdf` (built in the `register-member` function with pdf-lib) and `registration-form-<ts>.pdf` (built in the browser with jsPDF). Different layouts, different content order, different branding.
- Terms appear twice: the 19-clause facility terms list is printed, and the same subject matter is repeated again as separate waiver lines plus a consent checklist.
- The registration PDF does not draw the org logo — invoices/receipts do (they resolve and embed the logo asynchronously), so the agreement looks off-brand next to every other document.
- Health Conditions chips are not pre-filled in the staff drawer: the drawer is handed the members **list** row, which only selects `id, member_code, user_id, lead_id, branch_id, status, ...`. `health_conditions` / `fitness_goals` are never in that object, so `parseHealthConditions` always gets `undefined`. The full row (`memberCore`) is already fetched inside the drawer and does contain them.
- The registration record is written to two places with no link between them: `member_documents` (type `registration_form`) and `member_onboarding_signatures`.

## The single document — structure

One canonical agreement, Parts A–I, one final declaration, one signature:

```text
INCLINE — MEMBERSHIP REGISTRATION & AGREEMENT
  PART A  Member Information
  PART B  Membership & Payment Details
  PART C  Health Declaration + PAR-Q
  PART D  Assumption of Risk & Emergency Medical Consent
  PART E  Facility Rules & Membership Conditions
  PART F  Privacy & Data Protection Notice
  PART G  Communication Preferences
  PART H  Photography / Media Consent
  PART I  Declaration & Acceptance   →  one signature block
```

Acknowledgements (DPDP, communications, photo/media, facility rules, assumption of risk) stay as individually recorded tick-boxes inside their own Part — multiple acknowledgements, one signature. The final declaration text is the wording supplied in the request.

## Work

**1. One agreement spec (single source of truth)**
New `src/lib/registration/agreement.ts` defining the Parts A–I model: part ids, titles, ordered clauses, which acknowledgements belong to which part, and the final declaration. The existing 19 facility clauses are re-mapped into Parts D/E/F (no clause text lost, no clause printed twice) and the standalone waiver paragraph block is deleted. Mirrored byte-for-byte at `supabase/functions/_shared/agreement.ts`. `TERMS_VERSION` bumps to a new revision so signatures record which structure was accepted.

**2. One branded PDF renderer**
Extract the invoice-grade branded chrome in `src/utils/pdfBlob.ts` (band, logo, company block, right-hand title/meta, footer) into a reusable `brandedDoc()` helper and use it for the agreement as well as invoices/receipts, so all documents share one header/footer component. `buildRegistrationFormPdf` becomes `buildMembershipAgreementPdf` — async, logo-embedded, driven by the Parts A–I spec, with the acknowledgement grid and one signature block on the final page.

The `register-member` function's pdf-lib renderer is rewritten against the same spec module and the same visual order, fetching the branding logo the same way the client does, so the public flow and the staff flow produce the same document.

**3. One stored document**
Both flows write to a single canonical path `member-onboarding/<member_id>/membership-agreement.pdf` and one `member_onboarding_signatures` row (path, signature, PAR-Q map, acknowledgements, terms version, source). The `member_documents` row of type `registration_form` is kept as a pointer to that same storage path — not a second rendering — so the Document Vault keeps working. Legacy `onboarding-waiver.pdf` paths remain readable; nothing is deleted.

**4. Prefill fix + profile drawer**
The drawer passes the freshly-fetched full member row (which contains `health_conditions`, `fitness_goals`, `injuries_limitations`, `dietary_preference`) instead of the list row, so Health Conditions chips, Other text, and goals all hydrate. Where a signed agreement already exists, the drawer opens in read-only mode with a "Signed on …" summary, the acknowledgement list, and View / Print / Download of the single canonical PDF — re-signing requires explicit Amend. Sections in the drawer are relabelled to the Part A–I structure so the on-screen form and the printed PDF match one-for-one, using the standard drawer layout (sticky header, scrollable body, sticky footer).

**5. Verification**
Playwright run against the staff drawer for a member with recorded conditions (chips pre-checked), a fresh sign producing exactly one document, and the public `/register` flow producing an identical-looking PDF. Plus a check that no member ends up with both a waiver and a registration form for a new signature.

## Technical notes

- No schema migration required: `member_onboarding_signatures` already carries `par_q`, `consents`, `custom_terms`, `terms_version`, `waiver_pdf_path`, `signature_path`. Acknowledgements are stored in `consents` keyed by part.
- The client renderer becomes async (logo fetch); call sites in `MemberRegistrationForm.tsx` (save + print) are awaited with the button in its disabled/spinner state.
- Sensitive files continue to be read through `signMemberDocument` / `signOnboardingDocument` short-TTL signed URLs — never public URLs.
- Files touched: `src/lib/registration/agreement.ts` (new), `src/lib/registration/terms.ts`, `supabase/functions/_shared/agreement.ts` (new), `supabase/functions/_shared/terms.ts`, `src/utils/pdfBlob.ts`, `src/components/members/MemberRegistrationForm.tsx`, `src/components/members/MemberProfileDrawer.tsx`, `src/pages/PublicRegistration.tsx`, `supabase/functions/register-member/index.ts`.
