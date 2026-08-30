# PT Commission + Payroll — Audit Report and Fix Plan

Percentage model stays. No production data is changed by this plan until you approve the correction step.

## 1. Audit of live records (12 commissions, 0 payroll items paid yet)

Two payroll runs exist, both `calculated` — **no PT commission has been paid yet**, so no historical paid record is at risk.

| Invoice | Member | Trainer | Sale | Subtotal | GST | Paid / Outstanding | % | Current gross | Current GST ded. | Current net | Mths | Expected gross | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| INV-INC-26-0108 | Kaushay Jain | Ritesh | 24,000 | 22,857.14 | 1,142.86 | 24,000 / 0 | 40 | 9,600 | 480 | 9,120 | 3 | **9,142.86** | INCORRECT (GST in base) |
| INV-INC-26-0109 | Preeti Dewani | Ritesh | 18,000 | 17,142.86 | 857.14 | 18,000 / 0 | 40 | 7,200 | 360 | 6,840 | 3 | **6,857.14** | INCORRECT (GST in base) |
| BOS-INC-26-0016 | (Ritesh sale) | Ritesh | 27,000 | 27,000 | 0 | 27,000 / 0 | 40 | 10,800 | **540** | 10,260 | 3 | 10,800, ded 0 | INCORRECT (GST deduction on a zero-GST invoice) |
| BOS-INC-26-0048 | Manpreet Singh | Bhagirath | 14,000 | 14,000 | 0 | 14,000 / 0 | 50 | 7,000 | 0 | 7,000 | 1 | 7,000 | Amount CORRECT — installment wrongly still `blocked` |
| BOS-INC-26-0042 | Shubham Rajawat | Bhagirath | 15,000 | 15,000 | 0 | 15,000 / 0 | 50 | 7,500 | 0 | 7,500 | 1 | 7,500 | Amount CORRECT — installment wrongly still `blocked` |
| BOS-INC-26-0039 | Sahiba Mehndiratta | Bhagirath | 8,000 | 8,000 | 0 | 8,000 / 0 | 50 | 4,000 | 0 | 4,000 | 1 | 4,000 | Amount CORRECT — installment wrongly still `blocked` |
| BOS-INC-26-0018 / 0014 | Ritika Jain, Sandeep | Bhagirath | 9,000 each | same | 0 | fully paid | 50 | 4,500 | 0 | 4,500 | 1 | 4,500 | CORRECT |
| BOS-INC-26-0049 | Vishal Kandara | Bhagirath | 36,000 | 36,000 | 0 | 10,000 / 26,000 | 50 | 18,000 | 0 | 18,000 | 3 | 18,000 | CORRECT (correctly blocked) |
| BOS-INC-26-0013 / 0015 / 0017 | 3 members | Bhagirath | 60,000 / 36,000 / 37,500 | same | 0 | part-paid | 50 | 30,000 / 18,000 / 18,750 | 0 | same | 3 | same | CORRECT (correctly blocked) |

Installment splitting itself is already correct — every 3-month package is split into 3 equal monthly rows, never one lump sum.

## 2. Confirmed defects

1. **Commission base includes GST.** `generate_pt_commission` uses `price_paid × %`. `price_paid` is the GST-inclusive invoice total, so the 2 GST invoices are over-commissioned (₹457.14 + ₹342.86 gross).
2. **GST deduction applied without invoice GST.** `commission_deduction_percentage` (5% on Ritesh) is applied unconditionally. BOS-INC-26-0016 has zero invoice GST yet carries ₹540 deduction.
3. **Release gap.** 3 installments are `blocked` although their invoices show zero outstanding. `release_pt_commission_for_invoice` only runs from a `payments` trigger, so a payment that lands *before* the commission rows exist (or a balance cleared by invoice edit/adjustment) never releases them.
4. **`pt_commission_due_for_period` is not fail-safe.** It filters on `status='pending'` and payout month only. It does not re-verify the underlying invoice is fully paid and does not exclude rows that already carry a `payroll_item_id`.
5. **`payroll_mark_paid` sweeps by period, not by the amount actually computed.** Any installment that became pending after the item was computed is stamped paid with that item even though it was never in the payout figure.

## 3. Proposed function changes (no data migration in this step)

**`generate_pt_commission`**
- Resolve the invoice through `member_pt_packages.invoice_id`.
- `commission_base` = `invoices.subtotal` when `is_gst_invoice` and `tax_amount > 0`; otherwise `price_paid` (fallback to `price_paid` when no invoice is linked).
- `gross = commission_base × pt_share_percentage / 100`.
- GST deduction computed separately: applied **only** when the invoice actually carries GST; zero otherwise. `commission_deduction_percentage` stays the configured rate, not a proxy for invoice GST.
- Installment split, blocked/pending logic, and history behaviour unchanged.

**`pt_commission_due_for_period`** — add the safety filters: `payroll_item_id IS NULL`, parent commission not `reversed`/`cancelled`, and the linked PT invoice balance = 0.

**`release_pt_commission_for_invoice`** — unchanged logic, but also called from an `invoices` AFTER UPDATE trigger when `amount_paid`/`total_amount` change and the balance reaches zero, closing the release gap.

**`payroll_mark_paid`** — stamp only installments that satisfy the same `pt_commission_due_for_period` predicate, inside the same period, and only when still `pending` with `payroll_item_id IS NULL`.

**Kept as-is:** `reverse_trainer_commission`, `void_trainer_commission`, `tg_pt_commission_cancel_installments`, `payroll_create_run`, blocked status + `blocked_reason` text, installment history.

## 4. Correction of existing records (only after you approve)

- Recompute the 3 incorrect commissions (Kaushay, Preeti, BOS-0016) and their **unpaid** installments to the expected values above. No payroll item references them, so nothing paid is touched.
- Release the 3 wrongly blocked installments (Manpreet, Shubham, Sahiba) to `pending`, keeping their original month unless it has passed, in which case the existing release policy moves them to the current month.
- Leave all correctly blocked part-paid packages untouched.

## 5. Acceptance tests (run on a scratch package, then rolled back)

- ₹45,000 / 3 months / 40% / no GST → total ₹18,000, installments 6,000 × 3; payroll month 1 gross = base + 6,000 only.
- Part-paid ₹30,000 → all three installments blocked, `pt_commission_due_for_period` returns 0.
- Pay the remaining ₹15,000 → installments become pending, payroll picks up only the current month's 6,000.
- GST case ₹45,000 + ₹8,100 = ₹53,100 → base ₹45,000, gross ₹18,000 (never ₹21,240), GST deduction computed separately.
- Duplicate guard: same installment cannot appear in two runs once `payroll_item_id` is set.
