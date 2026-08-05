# Voided/refunded payments + convenience fee corruption

## What the screenshots actually show

**1. INV-INC-26-0027 (Syed Nida Ali)** — two payment rows exist in the ledger:

| Amount | Status | Meaning |
|---|---|---|
| ₹19,999 | refunded | the original wrong-amount entry, voided on 26 Jul ("incorrect invoice") |
| ₹18,000 | completed | the corrected, real collection |

The invoice itself is correct (subtotal ₹19,999, discount ₹1,999, total ₹18,000, paid ₹18,000, status paid). So the money is right; only the **presentation** is wrong:

- The Payments page counts the reversed ₹19,999 in "Filtered Total ₹37,999" — the total excludes `voided` but not `refunded`, so a cancelled entry inflates collections.
- The member Pay tab lists both rows flat, with no status badge, no "reversed" strikethrough, and the invoice number is plain text — no link to the invoice.
- The reversal row is not visually tied to the corrected row, so it reads like a second real payment.

**2. Reconciliation findings on INV-INC-26-0027** are a *different* real gap: line items sum to ₹18,000 while the invoice header says subtotal ₹19,999 + discount ₹1,999, and GST is ₹0 while items carry no tax. The correction rewrote the header but not the items, so the checker keeps flagging it. (INV-INC-26-0038 ₹62.45 gap is the convenience-fee rounding below.)

**3. Rehan khan INC-26-0030 / INV-INC-26-0038** — root cause confirmed:

```text
Annual Plan - 365 days            35,142.86
Online payment convenience fee       300.00 + 18% GST = 354.00
invoice total                     30,354.00   (after 6,900 discount)
paid                              15,000.00 (UPI, manual)
due                               15,354.00
```

`apply_convenience_fee(invoice_id)` **writes a line item into the invoice and permanently increases subtotal/tax/total**. It is called when a payment link/order is created — before any payment happens, and regardless of the instrument later used. Rehan then paid ₹15,000 by UPI *manually*, so the fee was never earned, yet it is still baked into the invoice and shown as due. It also breaks the GST checker (18% fee GST inside a 5% invoice) and produces the ₹62.45 reconciliation drift.

## The fix

### A. Convenience fee must never touch the invoice

Treat it as a **gateway-side surcharge on the payment attempt**, not an invoice line.

- Stop mutating `invoices` / `invoice_items`. Replace `apply_convenience_fee` with a pure calculator `quote_convenience_fee(invoice_id, method)` that returns the fee for display only.
- Charge the gateway the *net due + fee* at order/link creation, and record the fee on the **payment row** (`gateway_fee` / `lifecycle_metadata`) once the payment is actually captured. Invoice `amount_paid` credits only the base portion, so the invoice reaches ₹0 due exactly at its real total.
- Apply the fee only for card/netbanking/online instruments per gateway config — never for cash/UPI-manual/offline collection.
- Show it at checkout as "Convenience fee (added at payment)" so the member sees it before paying, with the invoice total unchanged.

**Data repair:** remove the ₹354 convenience-fee item from INV-INC-26-0038 and restore the invoice to ₹30,000 (Rehan's due becomes ₹15,000). Sweep any other invoice carrying an unpaid `reference_type='convenience_fee'` item and reverse it the same way.

### B. Reversed payments read as reversals everywhere

- Member Pay tab (`MemberProfileDrawer`): show a status badge per row; render `refunded`/`voided` rows muted with strikethrough amount, a "Reversed — <reason>" caption, and pair them under the replacement payment. Make the invoice number a link that opens the invoice.
- Payments page: exclude `refunded`/`voided` from Filtered Total, Today's Collection and Completed; add a "Net collected" line and keep reversed rows visible but visually demoted.
- Add the same treatment to `MyInvoices` (member portal) so members never see a cancelled entry as a payment.

### C. Close the reconciliation gap on corrected invoices

- Make `correct_invoice` rewrite line items in step with the header (or record the discount as an explicit discount item), so items always sum to subtotal.
- Recompute GST on correction; INV-INC-26-0027 shows ₹0 tax against a ₹19,999 subtotal.
- Re-run the checker on both invoices after repair; the three open findings should self-clear.

## Technical notes

- Migration: rewrite `apply_convenience_fee` → `quote_convenience_fee` (read-only), add reversal of existing fee items, patch `correct_invoice` item/GST sync.
- Edge functions `create-razorpay-link` and `create-payment-order`: quote the fee, add it to the gateway amount only, stop calling the mutating RPC; webhook records `gateway_fee` and credits only base to `amount_paid`.
- UI: `MemberProfileDrawer` payments tab, `Payments.tsx` totals, `MyInvoices.tsx`.
- Data fix runs as an insert/update batch after the migration, followed by `recheck_invoice_reconciliation` on the affected invoices.
