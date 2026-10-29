---
name: Membership Agreement — one document, one signature
description: Canonical Parts A–I membership agreement spec, branded PDF builder, single stored document per member
type: feature
---

ONE document → ONE signature → ONE printed PDF → ONE stored canonical document.

- Spec: `src/lib/registration/agreement.ts` (mirrored at `supabase/functions/_shared/agreement.ts`). Parts A–I, `AGREEMENT_ACKNOWLEDGEMENTS` (multiple tick-boxes, one signature), `FINAL_DECLARATION`, `AGREEMENT_VERSION`. `registration/terms.ts` is now only a derived compatibility layer — never add clauses there.
- PDF: `buildMembershipAgreementPdf()` in `src/utils/pdfBlob.ts` uses the shared `brandedDocHeader()` (same gradient/logo chrome as invoices). jsPDF Helvetica has no rupee glyph — all clause text passes through `pdfSafe()` which renders ₹ as "Rs.".
- Storage: exactly one file per member, upserted.
  - Staff drawer → bucket `documents`, path `<memberId>/membership-agreement.pdf`, `member_documents.document_type='registration_form'` row updated (not duplicated).
  - Public `/register` → bucket `member-onboarding`, same filename.
  - `member_onboarding_signatures.consents.pdf_bucket` records which bucket, so viewers sign the right one.
- Acknowledgement keys live in `consents` JSON: health_declaration, waiver, facility_rules, dpdp, whatsapp, photo (photo optional).
- Prefill: `MemberProfileDrawer` must pass `memberDetails` (full `select *` row) for health_conditions/fitness_goals — the list-page `member` prop omits them.
