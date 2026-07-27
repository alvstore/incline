## Step 1 — Audit findings (verified in code)

**A. Registration flow disconnect** (`MemberRegistrationForm.tsx` vs `PublicRegistration.tsx` + `register-member` fn)
- Public `/register` writes a signed waiver PDF + PNG signature to bucket `member-onboarding`, and inserts a row in `member_onboarding_signatures` with `signature_path`, `waiver_pdf_path`, `par_q`, `consents`, IP/UA.
- Backend "Membership Registration Form" drawer already **loads `par_q`** from that table (lines 110–131) but:
  - Does **not** check whether `signature_path` / `waiver_pdf_path` already exists → always shows an empty signature canvas.
  - Does **not** hydrate `governmentIdType/Number`, `fitnessGoals`, `medicalConditions`, `customTerms` from the public flow — parent (`MemberProfileDrawer` 2060–2085) only passes `profile.government_id_*` and `member.fitness_goals/health_conditions`. Public flow **doesn't write `government_id_*` to profiles** (only `health_conditions` on members via reg payload), so fields still look empty.
  - No `custom_terms` column exists on `member_onboarding_signatures` — custom addendums entered on backend are lost after PDF render.
  - Even when a signature already exists, backend still requires a re-sign to save; also blocks re-save with "Registration form already uploaded" (line 220) instead of offering **View / Download / Print** of the existing waiver.

**B. Welcome email on self-register**
- `register-member` fires `dispatch-communication` with `event: 'member_created'` and both `recipient` (phone) + `email` (line 527–540). Dispatcher only handles **one channel per call** — so email is silently dropped unless a `member_created` template exists on the WhatsApp channel AND a separate email dispatch is issued. No second call for `channel: 'email'` is made → **members never get a welcome email**.

**C. Invoice PDF not delivered via WhatsApp / Email**
- `systemEvents.ts` defines `receipt_generated` (document event) but **no `invoice_created` / `invoice_sent` event** is dispatched anywhere in `src/services/billingService.ts`, `paymentService.ts`, or the `record_payment` RPC path — grep shows zero call sites.
- Dispatcher supports `{{document_link}}` variable injection (line 276) but nothing produces the PDF, uploads it to storage, and passes the signed link. Result: invoice/receipt PDFs never leave the CRM.

**D. Member photo "uploads OK but not visible" (KAUSHAY INC-26-0007)**
- `MemberAvatarUpload.tsx` uploads to two buckets:
  1. Public `avatars` bucket → returns `publicUrl` → hands to parent via `onAvatarChange` (parent must persist to `profiles.avatar_url`).
  2. Private `member-photos` bucket → writes `members.biometric_photo_path` (NOT `biometric_photo_url`).
- The self-heal trigger `trg_mirror_member_photo_to_profile` deployed last session mirrors **`members.biometric_photo_url` → `profiles.avatar_url`**. Because the uploader writes `biometric_photo_path` and the parent may not always call `updateProfile({avatar_url})` (e.g. AddMemberDrawer path, or when opened from a context that discards the change), **the profile row stays with `avatar_url = null`** even though storage has the file.
- Additionally, KAUSHAY was created via lead-conversion (`provision-member-login`) — that path never sets `avatar_url` from an uploaded photo.

---

## Step 2 — Execution plan

### Epic 1 — Registration form sync (backend ⇄ public)
1. **Extend audit prefill.** In `MemberProfileDrawer.tsx` (2060–2085), also fetch the latest `member_onboarding_signatures` row for the member and pass down: `existingSignaturePath`, `existingWaiverPdfPath`, `signedAt`, `customTerms` (see #2), `parQ`, plus existing `health_conditions`, `fitness_goals`.
2. **Add `custom_terms` column** to `member_onboarding_signatures` (nullable TEXT) via migration + backfill nothing. Public `/register` doesn't collect it, but backend save path (line 282) will now persist it.
3. **Sync `government_id_*` to public flow.** Add `government_id_type` / `government_id_number` to the `register-member` payload → write to `profiles` in the same tx as member insert.
4. **Rebuild `MemberRegistrationForm.tsx` UX:**
   - If `existingWaiverPdfPath` present:
     - Show a green "Signed on {date}" banner with **Download PDF** + **Print** + **View signature** actions (uses `signMemberDocument` on the private path).
     - Hide the signature canvas + "Save Digital Copy" button.
     - Show Government ID and Custom Terms as **read-only** if already captured; allow editing only via a "Correct details" toggle that re-triggers PDF regeneration (new revision row, does not delete old one).
   - If no signature yet: keep current behavior but drop the hard block on line 219; instead update the existing row.
5. **Fix TanStack cache.** After save, invalidate `['member-onboarding-signatures', memberId]` and `['member-documents', memberId]` together.

### Epic 2 — Welcome email fires on self-register
1. In `register-member` (after step 12), issue a **second** `dispatch-communication` call with `channel: 'email'`, `event: 'member_created'`, `recipient: reg.email`, same dedupe key suffixed with `:email`.
2. Ensure `member_created` **email template** exists (Templates Hub → Email → seed via `AIGenerateTemplatesDrawer` default catalog).
3. Add unit sanity: dispatcher must accept `channel: 'email'` + `event` without a `payload.subject` (falls back to template subject).

### Epic 3 — Invoice / receipt PDF delivery
1. Add helper `sendInvoicePdfToMember(invoiceId)`:
   - Generate PDF via existing `utils/invoicePdf.ts`.
   - Upload to storage bucket `documents` under `invoices/{invoice_id}.pdf`.
   - Sign a 7-day URL, then call `dispatchCommunication({ event: 'invoice_created', channel: 'whatsapp', variables: { document_link, invoice_no, amount } })` **and** a second call with `channel: 'email'` (attaches same signed link + inline HTML summary).
2. Wire this helper into: `record_payment` client wrapper (`paymentService.ts`), `MembershipPurchaseDrawer` success, `POSCheckout` completion, and `verify-payment` edge fn (Razorpay success).
3. Add `invoice_created` and `receipt_generated` events to `systemEvents.ts` if missing; seed WhatsApp Meta template with `header_type='none'` + `{{document_link}}` body var (per memory rule).
4. Add manual "Resend invoice PDF" button on `InvoiceViewDrawer`.

### Epic 4 — Member photo visibility fix
1. **Fix the uploader:** in `MemberAvatarUpload.tsx`, after uploading to `avatars`, also `UPDATE profiles SET avatar_url = publicUrl WHERE user_id = member.user_id` **inside the component** (not relying on parent). This is idempotent and matches AppHeader's cache-busted read.
2. Also mirror to `members.biometric_photo_url` (not just `_path`) so `trg_mirror_member_photo_to_profile` self-heals older rows.
3. **Backfill KAUSHAY + any member with photo_path but null avatar_url:** SQL that reads `member-photos` object, signs a URL, writes to `profiles.avatar_url`.
4. Invalidate queries `['profile', userId]` and `['member', memberId]` after upload.
5. Add a small "Photo synced ✓" toast that confirms both bucket writes.

---

## Technical section
- **Files touched:** `src/components/members/MemberRegistrationForm.tsx`, `MemberProfileDrawer.tsx`, `MemberAvatarUpload.tsx`; `supabase/functions/register-member/index.ts`; `supabase/functions/verify-payment/index.ts`; `src/services/paymentService.ts` (+ helper `src/lib/billing/sendInvoicePdf.ts`); `src/utils/invoicePdf.ts` (export blob helper); `src/lib/templates/systemEvents.ts`.
- **Migrations:** `add_custom_terms_to_onboarding_signatures`, `backfill_member_avatar_from_biometric_path`, new `documents/invoices/*` upload policy grant for service role.
- **No RLS regressions.** All new selects go through existing member-scoped policies + `signMemberDocument`.
- **Dispatcher rules honored** — no direct inserts into `communication_logs`, every send uses `dispatchCommunication` with dedupe keys.

---

## Out of scope (this sprint)
- Reworking the printable Registration PDF layout.
- Migrating public `/register` to collect custom terms (backend-only field for now).
- Changing MIPS sync payloads (Epic 4 only touches avatar visibility).
