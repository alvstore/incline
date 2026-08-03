# GST correction fix + Incline 24/7 Terms rollout

## 1. Why INV-INC-26-0032 still shows 18% GST

Verified against the live invoice row and the `correct_invoice` function:

- The corrected amounts are already right: subtotal 11,428.57 + tax 571.43 = 12,000 (that is exactly 5%).
- But the invoice still stores `gst_rate = 18`. `correct_invoice` updates subtotal, discount, tax, total and status — it never writes `gst_rate`.
- Every display surface derives the labels from `gst_rate / 2`, so the drawer and the PDF print "CGST (9%) / SGST (9%)" against 5% money. The numbers are correct; only the labels lie.
- This is the only GST invoice in the system still on 18 — all other 43 are on 5, so it is a one-row data issue plus a function gap.

### Fix

1. Update `correct_invoice` to accept and persist the new GST rate (and keep `is_gst_invoice` consistent when the rate is 0), so a correction can never again leave a stale rate behind.
2. Pass the rate the Correct Invoice drawer already collects into the RPC.
3. Backfill this one invoice: set `gst_rate = 5` on INV-INC-26-0032 so the drawer and re-issued PDF read CGST 2.5% / SGST 2.5%.
4. Also fix the line item: the correction writes `unit_price = subtotal` but `total_amount = total`, which is why the PDF shows Rate 11,428.57 with Amount 12,000 on a qty of 1. Line amount should be the taxable value.

### GST 2.0 default (5%)

Gym/fitness services bill at 5%, but three creation surfaces still default to 18: Create Invoice, Purchase Membership, and Benefit Top-Up (the locker drawer already resolves the rate server-side). I will change those defaults to 5% while leaving the full rate dropdown available, so nobody accidentally raises another 18% invoice.

## 2. Incline 24/7 Terms & Conditions rollout

There are two places terms live today, and they do not match:

- `MemberRegistrationForm.tsx` — 16 clause `DEFAULT_TERMS` array printed into the signed membership form PDF, plus a staff-only "custom terms" addendum box.
- `PublicRegistration.tsx` (`/register`) — a single short waiver paragraph plus 4 consent checkboxes (waiver, DPDP, comms, photo).

### Plan

1. Move the clause list into one shared module (`src/lib/registration/terms.ts`) so both surfaces and the `register-member` edge function PDF read the same source.
2. Add the six new Incline 24/7 clauses, merged with the existing set (no duplicates): 24/7 unstaffed-hours access consent + medical liability + CCTV consent, no outside trainers, turnstile access control and damage liability, indoor-footwear-only hygiene rule, locker authorised-use/overnight/owner's-risk policy, and parking at owner's risk.
3. Reconcile overlaps: the existing "Personal Training Policy", "Locker Use" and "CCTV" clauses get replaced by the stricter new wording rather than sitting alongside it.
4. On `/register`, replace the single waiver paragraph with a scrollable, numbered clause list rendered from the shared module (same glass styling), and add one explicit required checkbox for the 24/7 unstaffed-access + facility rules acknowledgement alongside the existing consents. Consent keys are persisted, so the edge function records exactly what was shown.
5. Version the terms: store a `terms_version` string with each signature so future changes are auditable and we can tell who signed which revision.
6. Backfill: existing signed members were not shown these clauses. Rather than rewriting history, I will surface the new terms as a re-acknowledgement — flagged on the member record, prompted in the member portal — so consent stays legally clean. Say the word if you'd prefer a silent backfill instead.

## 3. UI/UX (ui-ux-pro-max)

Terms rendering on both surfaces gets the same treatment: numbered section cards, sticky "scroll to accept" affordance, readable 14px line-height-relaxed body, and a clear required/optional split on the consent block — Vuexy tokens throughout, no new colour system.

## Technical details

- DB: new migration for `correct_invoice` (add `p_gst_rate`, persist it, fix the line-item amount) + a one-row backfill for INV-INC-26-0032; add `terms_version` to `member_onboarding_signatures`.
- Frontend: `CorrectInvoiceDrawer.tsx` (pass rate), `CreateInvoiceDrawer.tsx` / `PurchaseMembershipDrawer.tsx` / `TopUpBenefitDrawer.tsx` (default 5), new `src/lib/registration/terms.ts`, `MemberRegistrationForm.tsx`, `PublicRegistration.tsx`.
- Edge: `register-member` imports the shared clause list for the generated waiver PDF.
