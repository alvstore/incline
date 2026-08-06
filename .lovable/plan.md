# Audit: Sachin Jain (INC-26-0082) — "No Plan + Due ₹12,500", and Void vs Refund

## What the data actually shows

Verified against live records for INC-26-0082:

- Membership `5f2cedb0…`: status **pending**, 06 Aug 26 → 05 Aug 27, price 25,000, discount 900.
- Invoice **BOS-INC-26-0001**: total 25,000, paid 12,500, status **partial**, `due_date = 2026-08-06` (same day it was created), `payment_due_date` empty.
- Payments: 25,000 cash marked **refunded / voided** with reason "Superseded by correction: partial payment done", plus a new 12,500 cash payment.

So the correction did exactly what it was coded to do — but two side effects produced the symptoms.

## Root cause 1 — the correction silently killed the plan

The payment-correction path is: `edit_payment` → `void_payment` (kill old) → `record_payment` (write new).

`void_payment` deliberately demotes any membership linked to that invoice from **active** back to **pending** (an anti-fraud step: money reversed, so access is pulled, and it also re-evaluates gate access). `record_payment` has **no** membership logic at all — nothing ever promotes the plan back.

Result: correcting a payment on a membership invoice always leaves the member plan-less. That is why he reads "inactive / No Plan / Due ₹12,500" even though 12,500 was genuinely collected. Two other members are in the same state today: **INC-26-0014** and **INC-26-0064**.

Note the real remaining balance is also debatable: the invoice still totals 25,000. If the true agreed price was 12,500 the *invoice* needed correcting, not just the payment. Both cases need to be handled.

## Root cause 2 — void and refund are the same record

The payments table has two independent fields:

- `status` (payment_status enum: pending / completed / failed / **refunded** — there is no `voided` value)
- `lifecycle_status` (created / pending_confirmation / settled / failed / **voided**)

`void_payment` sets **both**: `status = 'refunded'` and `lifecycle_status = 'voided'`. The UI helper `paymentDisplay.ts` then reads `status === 'refunded'` first and prints "Refunded". So every internal correction/cancellation is mislabelled as money-returned-to-the-member — in payment history, invoices, member profile, reports, and reconciliation. You have never refunded anyone, yet the app says you have.

The distinction to enforce:

```text
VOID     money never left the till / entry was wrong   -> reversal of an erroneous record
REFUND   money was actually paid back to the member    -> real outflow, needs method + date
```

`lifecycle_status = 'voided'` with no refund settlement is the reliable signal; `refund_amount` / `refunded_at` on the invoice (or a correction settled as refund_cash/refund_upi/refund_wallet) is the real-refund signal.

## Root cause 3 — no due date anywhere

`invoices.due_date` is set to the sale date on creation and `payment_due_date` is never populated. Across the whole app due dates are only ever *read* (Follow-up Center, member checkout) — there is no screen to set or change one. So a partial payment becomes instantly "overdue on day zero" and follow-up has nothing meaningful to work from.

---

## Plan

### A. Fix the correction lifecycle (backend)

1. Rework `void_payment` so the membership demotion is conditional, not automatic: after the void, recompute the invoice and only demote when the invoice has **zero** money left against it. A partially-paid invoice keeps the plan active.
2. Add a membership re-activation step to `record_payment`: when a payment lands on an invoice whose items reference a membership, promote that membership from `pending` back to `active` (and re-run access evaluation) as long as the invoice is not cancelled.
3. Wrap `edit_payment` so the void+record pair is treated as one correction: the plan state at the end must equal the plan state the new payment justifies, never a leftover `pending`.
4. Data repair for the three affected members (INC-26-0082, INC-26-0014, INC-26-0064): re-activate the memberships that were demoted by a correction and are backed by a live invoice, with an audit-log entry each.

### B. Separate Void from Refund (backend + UI)

5. Stop overloading `status`: `void_payment` sets `lifecycle_status = 'voided'` and leaves `status` as a non-refund value (add a dedicated reversal marker rather than reusing `refunded`). Genuine refunds — issued only via invoice correction settled as refund_cash/refund_upi/refund_wallet, or an explicit refund action — keep `refunded`.
6. Update `paymentDisplay.ts` to return three states: **Completed**, **Voided (corrected)**, **Refunded (money returned)**, each with its own badge colour and caption, and keep both excluded from collections.
7. Roll the new labels through Payments, Invoices, Invoice view, Member profile/invoices drawers, Sales & GST report tabs, and the reconciliation card, so "Refunded" only ever appears where cash actually went back.
8. Backfill: existing voided-by-correction rows are relabelled as voided, not refunded (no financial values change — this is a labelling correction).
9. In the correction drawer, make the settlement choice explicit and plain-English: "No money moved — correct the record" vs "Money returned to member (cash / UPI / wallet)", defaulting to the former.

### C. Due date management (UI)

10. Add a due-date field to invoice creation and a **Set / change due date** action on any invoice with a balance — a right-side sheet with quick presets (Today, +3 days, +7, +15, end of month) plus a date picker and a required reason, written to `payment_due_date` with an audit trail.
11. Surface it where staff chase money: member row and profile show "Due ₹X · by DD MMM" (red when past due, amber within 3 days, slate otherwise), and Follow-up Center orders by the new date.
12. Sensible defaults on creation so nothing is born overdue: full payment → no due date; partial/unpaid → configurable default (7 days) instead of the sale date.

### D. Guardrails

13. A reconciliation check that flags any `pending` membership whose invoice has money against it — so this class of drift surfaces itself instead of being found by a member being denied entry.

## Technical notes

- Touched functions: `void_payment`, `record_payment`, `edit_payment`, `correct_invoice` (settlement labelling), plus a new due-date update RPC with capability check.
- Touched UI: `src/lib/payments/paymentDisplay.ts`, `Payments.tsx`, `Invoices.tsx`, `InvoiceViewDrawer.tsx`, `CorrectInvoiceDrawer.tsx`, `MemberProfileDrawer.tsx`, `MemberInvoicesDrawer.tsx`, `SalesReportTab.tsx`, `ReconciliationFindingsCard.tsx`, `FollowUpCenter.tsx`, plus a new `SetInvoiceDueDateDrawer.tsx` (Sheet, per the no-dialog rule).
- All new writes go through server RPCs with `has_capability` checks and audit-log rows; no multi-step client writes.
- Reversed payments continue to be excluded from every revenue/collection total — this plan changes labels and lifecycle, not amounts.
