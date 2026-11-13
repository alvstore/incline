# Fix: Dilip Jain shows "No Plan" despite a paid plan

## What I found
- Dilip Jain (INC-26-0254) **does** have a plan: 21 Oct 2026 to 20 Oct 2027, ₹25,000, with ₹10,000 received (dated 21 Oct) and ₹15,000 due.
- The plan is stuck as **"pending"** (not started), so the members list shows "No Plan" and "Inactive".
- Why: the first ₹10,000 was recorded, then reversed (voided) and re-recorded a second later with the 21 Oct date. The rule that switches a plan on after payment checks the invoice's "amount received" total, and at that exact moment the total still read ₹0 because of the reversal. So it skipped switching the plan on.
- He is the only member stuck this way right now.

## Fix
1. **Make the switch-on rule reliable:** turn the plan on when a real (not reversed/failed) payment of more than ₹0 is recorded against its invoice, instead of relying on the invoice total at that instant. Same rule, same conditions otherwise (cancelled invoices still ignored, voids/refunds still ignored).
2. **Repair Dilip's plan:** switch his plan to active (dates unchanged, ₹15,000 still due). His gate access re-evaluates automatically; the due amount stays an "amber" desk alert under existing gate rules.
3. **Safety net:** the daily reconciliation check also flags any plan that has a received payment but is still "pending" after its start date, so this can't silently recur.
4. **Test:** add a small test for "void then re-record payment still activates the plan".

## Technical details
- New migration replacing `tg_reactivate_membership_on_payment`: condition on `NEW.status='completed' AND NEW.amount>0` (plus existing void/lifecycle/cancelled checks) rather than `invoices.amount_paid` read in the AFTER trigger before `recompute_member_invoice_totals` settles.
- One-off data update: `memberships` id a278d504… status pending → active, logged to audit_logs.
- Add stalled pending-with-payment predicate to the daily reconciliation findings (existing `stalled_membership_activation` finding type).
- Verify: re-query the member, open Members list signed in and confirm plan + Active badge.
