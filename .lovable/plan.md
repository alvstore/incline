# Custom 10-day memberships — Pratik & Arpit Bansal

## What will happen
For each member (both active, Incline branch):

| Member | Code | Amount | Mode | Dates |
|---|---|---|---|---|
| Pratik Bansal | INC-26-0240 | ₹2,500 | Cash | 2 Nov – 11 Nov 2026 (10 days) |
| Arpit Bansal | INC-26-0239 | ₹2,500 | Cash | 2 Nov – 11 Nov 2026 (10 days) |

1. Create one BOS (no-GST) invoice each for ₹2,500, line "Custom membership – 10 days", marked fully paid in cash (₹0 due).
2. Start an active membership for 2–11 Nov 2026 on each, so "Pending Plan / No Plan" disappears and the gate opens for them.
3. No new plan appears in your plan list or on the website.
4. Record an audit note ("Custom 10-day plan, sold by desk, approved by Rajat") and verify invoice, payment and membership read back correctly.

## Technical details
- Use the atomic `purchase_membership` RPC (single source of truth) with `p_price=2500`, `p_start_date='2026-11-02'`, `p_end_date='2026-11-11'`, `p_payment_method='cash'`, `p_amount_paid=2500`, unique idempotency key per member.
- The RPC requires a plan reference: reuse an existing (or hidden, inactive) plan only as a technical link with the price/dates overridden; invoice item description renamed to the custom label. No new public plan row is created.
- Ensure invoice is BOS series with GST = 0; MIPS access sync fires via existing triggers.
- Confirm with a read query; no code changes.
