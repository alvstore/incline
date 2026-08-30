---
name: PT commission — GST-exclusive base, monthly installments
description: Trainer PT commission rules: pre-GST base, separate GST deduction, full-payment gating, monthly installment payout, duplicate protection
type: feature
---

- Commission base is ALWAYS exclusive of GST: use `invoices.subtotal` when the PT invoice has `is_gst_invoice` and `tax_amount > 0`; otherwise the actual PT sale amount (`member_pt_packages.price_paid`).
- `gross = commission_base × trainers.pt_share_percentage / 100`.
- GST deduction (`trainers.commission_deduction_percentage`) is a SEPARATE concept and applies ONLY when the underlying PT invoice actually carries GST. Never auto-deduct 5% on zero-GST/BOS invoices.
- Total commission is split evenly across `pt_packages.duration_months` into `pt_commission_installments` (remainder to the last month). Never pay the full commission in month 1.
- Commission is payable only when the PT invoice balance is zero. Otherwise installments stay `status='blocked'` with `blocked_reason`.
- Release happens via `release_pt_commission_for_invoice`, fired both from the payments trigger and from `trg_invoice_release_pt_commission` on `invoices` (amount_paid/total_amount change to zero balance). Passed months move to the current payout month.
- `pt_commission_due_for_period` returns only: pending, `payroll_item_id IS NULL`, commission not reversed/cancelled, invoice fully paid, within period. `payroll_mark_paid` stamps the same predicate — one installment can never land in two payroll runs.
