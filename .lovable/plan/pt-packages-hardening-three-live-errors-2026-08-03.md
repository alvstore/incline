# PT packages hardening + three live errors

## 1. Trainer lookup crash in the PT purchase drawer (confirmed)

`PurchasePTPackageDrawer.tsx` line 151 asks for `profiles:profiles!trainers_user_id_fkey(full_name)`. There is no declared foreign key from `trainers.user_id` to `profiles`, so the API rejects the request with 400 and the trainer commission preview never loads.

Fix: drop the embed and fetch the trainer row and the profile name in two plain queries (the pattern already used in `trainerService.ts` and `useUnifiedStaff.ts`). No schema change, no new FK.

## 2. "WinAnsi cannot encode ₹" on contract PDFs (confirmed)

`supabase/functions/contract-signing/index.ts` draws text with a pdf-lib standard font, and the employment contract body (`contractTemplateV2.ts`) formats salary as `₹1,23,456`. Standard fonts cannot encode the rupee glyph, so PDF generation throws.

Fix: sanitise every string before `drawText` in that function — replace `₹` with `Rs.` and strip other non-WinAnsi characters. Same guard added to the other pdf-lib functions (`register-member`, `deliver-scan-report`) so a stray symbol can never break a member's waiver or scan report.

## 3. sync-to-mips running out of compute

The function still fails with "not enough compute resources". It already has a circuit breaker and photo normalisation. Next pass: stop holding photo bytes in memory across steps (stream fetch → upload → release), process one person per invocation instead of a batch loop, and return early when the queue is empty. I will read the current function and the failure logs before changing anything, then report what actually consumed the memory.

## 4. PT workflow audit and 2026 rebuild

Areas to verify and fix, end to end:

- **Purchase → invoice**: confirm the invoice created by `purchase_pt_package` carries the right GST (5% inclusive or 0% exempt), discount, convenience fee and line items, and that the start date now chosen in the drawer flows into the invoice period.
- **Partial payments**: PT purchase currently records one payment. Add proper part-payment support — record what is paid, leave the rest as balance on the same invoice, and keep the package in `pending_payment` until the invoice is settled (or activate with a flagged balance, your call — see question below).
- **Due dates**: give every PT invoice with a balance a due date, and surface days-overdue on the PT dashboard and member profile.
- **Due-date notifications**: wire PT invoices into the existing reminder engine (`send-reminders`) so members get WhatsApp/Email/RCS nudges before and after the due date, through `dispatchCommunication` only. Includes seeding the missing templates in the Templates Hub.
- **Attendance and commission**: re-verify `log_pt_session` for monthly packs (no session decrement, start-date guard, expiry guard) and that trainer commission is written as `earned_unconfirmed` and released against confirmed payment, not on a fixed drip.
- **UI/UX pass (2026)**: PT dashboard KPI row for monthly clients (active clients, PT MRR, renewals due, dues outstanding, attendance rate), a dues/overdue panel, part-payment collection from the package card, and consistent Sheet-only drawers with Vuexy cards, skeletons, empty states and colour-coded badges.

## 5. Skills

`ui-ux-pro-max` is already in the project's skill lock file — it only needs activating from Settings > Skills. There is no "senior architect" skill installed; I can draft one (architecture review checklist: RPC-first writes, branch scoping, RLS, dispatcher-only comms, atomic operations) and submit it for your approval.

## Technical notes

- Files: `src/components/pt/PurchasePTPackageDrawer.tsx`, `PTSessions.tsx`, `PackageCard.tsx`, `PendingPaymentsAlert.tsx`, `ClientsTable.tsx`, `src/services/ptService.ts`, `supabase/functions/contract-signing/index.ts`, `register-member`, `deliver-scan-report`, `sync-to-mips`, `send-reminders`.
- Migrations: PT invoice due date + part-payment handling inside `_purchase_pt_package_impl` / `record_payment`, and a PT dues view for the dashboard.
- All new writes stay on server RPCs; all outbound messages stay on `dispatchCommunication`.
