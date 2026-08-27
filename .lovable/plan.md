# Purchase PT Package — partial payment, due date, UTR capture, drawer redesign

## What's broken today (verified in code + database)

- The drawer always charges the **full package price**. `_purchase_pt_package_impl` calls `settle_payment(... _price_paid ...)` — there is no "amount collected now" input, so Vishal's ₹10,000 advance against a ₹36,000 sale cannot be recorded.
- **No due date.** The invoice is created with `due_date = CURRENT_DATE`, always. The drawer never asks.
- **No transaction reference.** `settle_payment` accepts `p_transaction_id`, but the PT purchase passes `NULL` — so UPI/card/bank UTRs are never stored and reconciliation has nothing to match on.
- Payment method options are limited to cash/card/UPI/bank transfer with no reference field, and the summary block shows only Subtotal / GST / commission / Final total — no balance line.

## What we'll build

### 1. Payment section rebuilt ("Collect now" block)
- **Amount collected now** field with quick chips: `Full`, `50%`, `Custom`, plus `₹0 — invoice only`. Defaults to Full so today's flow is unchanged.
- Live **Balance due** line in the summary, styled amber when > 0, emerald "Paid in full" when 0.
- **Due date** control, shown whenever balance > 0: preset chips `+7 · +10 · +15 · +30 days` plus a date picker for anything else. Required if a balance exists.
- **Reference / UTR** field, shown for UPI, card, bank transfer and cheque (hidden for cash), with method-aware placeholder (UTR / auth code / cheque no.) and light validation (min 4 chars). Stored on the payment row so it appears in Money Movement and reconciliation.
- Method list gains **Cheque** and **Wallet** to match the payment enum.

### 2. Server: partial settlement inside the same transaction
- Extend `purchase_pt_package` / `_purchase_pt_package_impl` with `_amount_paid numeric default null` (null = full), `_due_date date default null`, `_transaction_id text default null`, `_payment_notes text default null`.
- Invoice is created with the chosen `due_date`; `settle_payment` is called with the collected amount and the UTR, so the invoice lands as `partial` (or `pending` when ₹0) instead of `paid`.
- Package activation must not depend on the invoice being fully paid: on a partial in-person collection the package activates for the purchased window and the balance is tracked on the invoice. The 30-minute pending-reversal window only stays in force for the payment-link flow and for ₹0 collections.
- Commission is still generated from the full taxable subtotal (unchanged), so trainer payout math is untouched.
- Existing callers keep working — all new arguments are defaulted.

### 3. Reconciliation follow-through
- The stored reference flows into the payments ledger and the invoice, so a UPI UTR shows in payment history, the invoice PDF/receipt, and reconciliation findings.
- Balance and due date surface on the member's PT package card and the invoice, so staff can settle the remaining ₹26,000 later through the existing Record Payment drawer.

### 4. Design pass (house rules, Vuexy)
- Regroup the drawer into four labelled `rounded-2xl` cards: **Trainer → Package → Schedule & Tax → Payment**, each with a quiet uppercase section label; today the trainer card floats above an unlabelled tabs/list/footer stack.
- Sticky money summary above the footer with a clear hierarchy: Subtotal → GST → Discount (when the charge is overridden) → Commission → **Final total** → **Collected now** → **Balance due**. Balance is the loud amber number when non-zero.
- Primary button label becomes contextual: `Charge ₹10,000 & Assign` when partial, `Charge ₹36,000 & Assign` when full, `Create invoice & Assign` at ₹0.
- Accessibility: every new control gets a real `<label>`, 44px targets, visible focus rings, `aria-label` on the preset chips; skeletons while the trainer/package lists load.

## Technical notes

- `src/components/pt/PurchasePTPackageDrawer.tsx`: new state `collectMode` (`full | partial | none`), `amountPaid`, `dueDate`, `txnRef`; the idempotency draft key includes amount + due date so changing them mints a fresh key; validation blocks submit when balance > 0 and no due date, or when a non-cash method has an empty reference.
- Migration on `purchase_pt_package` and `_purchase_pt_package_impl` for the four new arguments plus the activation change described above.
- Payment method strings continue to route through `normalizePaymentMethod`; due dates reuse the existing `set_invoice_due_date` semantics (date-only, branch-scoped).
- Currency, GST (5% inclusive / exempt), trainer reassignment and duplicate-sale guard behaviour all stay exactly as they are.

## Verification with Vishal kandara (INC-26-0101)

1. Open the drawer, pick the 3-month plan, override the charge to ₹36,000 — summary shows ₹36,000 total, ₹0 balance.
2. Set Collect now = ₹10,000 → balance ₹26,000 in amber, due-date chips appear; pick `+15 days`.
3. Method UPI → reference field appears; enter the UTR.
4. Charge → package active for 3 months, invoice `partial` with amount paid ₹10,000, due date set, UTR visible in payment history, trainer commission unchanged.
5. Later, record ₹26,000 through the existing payment drawer and confirm the invoice flips to `paid`.
