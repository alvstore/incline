# Fix Pack: Member actions, Invoice download/PDF, Reminders, Recent Payments naming

Five small, scoped fixes — all UI/edge-function level. No schema changes.

---

## 1. Members → row actions: respect "Scheduled" plan

**File:** `src/pages/Members.tsx` (action dropdown around line 762)

Current logic only checks `activeMembership`, so Love Kumar (who has a **scheduled** plan starting 27 Jul) sees "Add Plan" + nothing else.

Change:
- Compute `existingPlan = activeMembership || scheduledMembership` (already derived earlier in the row).
- Primary item label:
  - `activeMembership` → **Renew Plan**
  - `scheduledMembership` (no active) → **Reschedule Plan** (opens existing PurchaseMembershipDrawer in "edit start date" mode — for now reuses purchase drawer, label only)
  - none → **Add Plan**
- Show the secondary block (Buy PT Package, Quick Freeze) when **either** active OR scheduled exists. Quick Freeze stays disabled for scheduled (only active can be frozen) with tooltip "Available after plan starts".
- Add new item "Collect Due ₹X" (opens existing payment link drawer for the linked invoice) when `pendingDues > 0` — applies to both active and scheduled. This solves the "₹25,000 due but no quick way to collect" gap visible in the screenshot.

---

## 2. Invoices list → Download menu item is dead

**File:** `src/pages/Invoices.tsx` line 418–421

The `DropdownMenuItem` for Download has no `onClick`. Wire it to:

```ts
onClick={async () => {
  const full = await fetchInvoice(invoice.id); // existing billingService
  const brand = await resolveBrandForBranch(invoice.branch_id);
  const blob = buildInvoicePdf(toPdfInput(full, invoice.members), brand);
  downloadBlob(blob, `Invoice-${invoice.invoice_number}.pdf`);
}}
```

Use the same `toPdfInput` shape already used inside `InvoiceViewDrawer.handleDownloadPDF`. Extract that mapper into `src/utils/invoicePdfInput.ts` so both call sites share it. Show a toast on success / error.

---

## 3. Invoice PDF → on-brand Incline look

**File:** `src/utils/pdfBlob.ts` (`header`, `buildInvoicePdf`, footer helpers)

Keep jsPDF (no new deps). Tighten brand fidelity:

- **Header band:** swap the flat primary fill for the Vuexy indigo→violet gradient (simulate via two stacked rects with interpolated colors). Increase header height to 38mm. Left side: Incline logo (already cached via `_logoCache`) at 28mm wide. Right side: large `TAX INVOICE` / `INVOICE` in white 18pt + invoice # and date stacked below in 9pt white/80%.
- **Brand line under header:** thin 1mm violet bar `#7C3AED`, then `The Incline Life by Incline` tagline in `BRAND.muted` 8pt italic (required by the brand-identity memory).
- **Bill To / From cards:** two equal-width rounded rects (`doc.roundedRect`, r=2) side-by-side, soft slate fill (`#F8FAFC`). From-card lists branch name, address, phone, email, GSTIN (when present).
- **Items table:** `theme: 'plain'` with a single 0.2mm bottom border per row, header row filled with `#EEF2FF` and indigo text (not white-on-violet which looks heavy on A4). Right-align Qty/Rate/Amount. Monospace amounts.
- **Totals block:** right-aligned card with Subtotal / Discount / Taxable / CGST / SGST / IGST (only the lines that apply) / **Total** in bold 12pt indigo, then **Amount Paid** (green) and **Balance Due** (red if >0).
- **Payment status stamp:** if `status === 'paid'` overlay a 30°-rotated `PAID` outline stamp (green) at ~40% opacity; if `voided` overlay `VOID` (red).
- **Footer:** thin top border, three columns — left "Thank you for choosing Incline", center support contact, right page `n / N`. Legal line: `The Incline Life by Incline · CIN/GSTIN if set · {website}`.
- **Typography:** use helvetica (jsPDF built-in) but normalize sizes: H1 18 · H2 11 · body 9 · meta 8. No size below 8.

`buildThermalReceiptPdf` (POS) keeps its current 80mm layout — only the A4 invoice changes.

Verify by generating a sample blob for an invoice with mixed items + dues and opening it locally.

---

## 4. Payment Reminders → skip when invoice already paid

**File:** `supabase/functions/send-reminders/index.ts` (payment block ~line 237)

Inside the `for (const reminder of pendingReminders)` loop, after loading `invoice`, add a guard **before** any send work:

```ts
const totalAmt = Number(invoice?.total_amount || 0);
const paidAmt  = Number(invoice?.amount_paid  || 0);
const pendingAmt = Math.max(totalAmt - paidAmt, 0);
const terminal = ['paid', 'voided', 'cancelled', 'refunded'].includes(invoice?.status);

if (!invoice || terminal || pendingAmt < 1) {
  await adminClient
    .from('payment_reminders')
    .update({ status: 'skipped', skipped_reason: terminal ? `invoice_${invoice?.status}` : 'no_balance', updated_at: new Date().toISOString() })
    .eq('id', reminder.id);
  continue;
}
```

Also pre-filter the initial select with `.in('invoice_id', <unpaid invoice ids>)`? — keep DB load low by adding a join filter is non-trivial in PostgREST, so the in-loop skip is cheaper and correct.

Add `skipped_reason text` column to `payment_reminders` via migration (single ALTER TABLE … ADD COLUMN IF NOT EXISTS) so the skip is auditable. (Tiny migration — included in this plan as the only DB change.)

Bump fn header to `// send-reminders v2.2 — skip when invoice paid/void/zero balance.`

---

## 5. Audit "user shows staff name instead of customer"

**Audit scope:**

- `src/pages/Payments.tsx` row line 423 → already uses `resolveMemberDisplay(payment.members).name`. ✅ correct.
- `src/pages/Invoices.tsx` invoice list → already resolved. ✅
- `src/components/invoices/InvoiceViewDrawer.tsx` Bill-To → already resolved.
- **Suspected leak:** `payment.received_by` (auth user id of staff who recorded the payment) was being surfaced in some places. Grep for `received_by`, `recorded_by`, `created_by` joined to `profiles` in:
  - `src/pages/Payments.tsx`
  - `src/components/invoices/InvoiceViewDrawer.tsx`
  - `src/components/payments/*`
  - `src/pages/Dashboard.tsx` (recent payments widget)
  - `src/pages/MemberProfile.tsx` "Recent payments" tab
- For every match: if the display is meant to identify the **customer**, replace with `resolveMemberDisplay(row.members)`. If it legitimately shows "Recorded by …" (audit context), keep but relabel the column header to **Recorded by** and render in `text-xs text-muted-foreground` so it cannot be confused with the customer name.
- Add a unit-style sanity check: `src/services/__tests__/resolveMemberDisplay.spec.ts` covering profiles-only, lead-only, both, and empty cases (mirrors existing `walletService.sanity.mjs` style).

If the audit finds zero remaining leaks in shipped UI, document this in `mem://architecture/customer-vs-staff-naming` so future code doesn't regress.

---

## Out of scope (will not touch this pass)

- Razorpay link expiry policy.
- Reminder cadence changes (only paid-skip logic).
- POS thermal receipt layout.
- Any DB grants/RLS changes.

## Acceptance

1. Members row for Love Kumar (scheduled plan, ₹25,000 due) shows: **Renew Plan**, **Buy PT Package**, **Quick Freeze** (disabled w/ tooltip), **Collect Due ₹25,000**.
2. Invoices list → kebab → **Download** writes `Invoice-INV-INC-26-0014.pdf` and toasts success.
3. Generated PDF shows indigo→violet header, Incline logo, "Bill To" + "From" cards, totals card, "PAID"/"VOID" stamp when applicable, branded footer.
4. After marking an invoice paid, the next `automation-brain-tick` run marks its `payment_reminders` rows as `status='skipped'` with `skipped_reason='invoice_paid'` and sends nothing.
5. Grep audit for `received_by|recorded_by` UI usage returns either zero matches in customer-name slots, or matches relabeled as "Recorded by".

## Files touched

- `src/pages/Members.tsx`
- `src/pages/Invoices.tsx`
- `src/components/invoices/InvoiceViewDrawer.tsx` (extract mapper)
- `src/utils/invoicePdfInput.ts` (new — shared mapper)
- `src/utils/pdfBlob.ts` (PDF redesign)
- `supabase/functions/send-reminders/index.ts`
- Migration: `payment_reminders.skipped_reason` column
- Optional audit edits in Dashboard / MemberProfile recent-payments widgets
- `src/services/__tests__/resolveMemberDisplay.spec.ts` (new)
