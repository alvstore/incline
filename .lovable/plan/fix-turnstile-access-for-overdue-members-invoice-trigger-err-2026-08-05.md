# Fix: Turnstile access for overdue members, invoice trigger error, member add-on payments

## What I verified

- `invoices` has **no** `paid_at`, `payment_method`, or `payment_reference` columns, but the trigger `enforce_member_invoice_defaults` (fires on every member-initiated invoice insert) assigns to all three. Any invoice created while logged in as a member fails with `record "new" has no field "paid_at"`. Staff inserts skip the trigger body, which is why only members hit it.
- `validate_member_checkin` checks only: already-checked-in, active membership, branch, expiry. **There is no dues check at all.** Rehan Khan (INC-26-0030) has INV-INC-26-0038 at ₹30,000 with ₹15,000 paid and payment due date 2026-08-04 (yesterday) — so the gate correctly followed the current rules and let him in.
- The turnstile itself grants entry from the MIPS device face roster (`validTimeEnd`); the CRM check-in is recorded after the fact by `mips-webhook-receiver`. So blocking at the software layer alone is not enough — hardware validity must also be pulled back.
- Member add-on purchase (`PurchaseAddOnDrawer`) calls `purchase_benefit_credits`, which immediately writes an invoice **and settles a payment** with a manual method (cash/card). There is no Razorpay/online gateway path for members, and the invoice insert is what trips the trigger error above.

## Plan

### 1. Repair the invoice defaults trigger
Rewrite `enforce_member_invoice_defaults` to set only columns that exist (`status='pending'`, `amount_paid=0`, clamp `discount_amount`, null `invoice_number`). Drop the `paid_at` / `payment_method` / `payment_reference` assignments.

### 2. Dues-aware access control (the serious one)
Add a single source of truth `member_access_status(_member_id, _branch_id)` returning `allowed`, `reason`, `outstanding_amount`, `days_overdue`. Rules:
- Any invoice for the member with status `pending`/`partial`/`overdue` and `payment_due_date < current_date` (net of reversed payments) beyond a configurable grace period blocks access.
- Grace days read from branch settings (`dues_grace_days`, default 0) so the club can tune it.
- Frozen/expired/no-membership reasons stay as they are today.

Wire it into:
- `validate_member_checkin` — return `valid: false, reason: 'dues_overdue'` with the amount, so manual and gate check-ins are rejected and the reason is logged.
- `mips-webhook-receiver` — when a punch is rejected for dues, record a denied access event instead of a successful attendance row, and notify the front desk.
- Hardware enforcement: extend the existing expired-access sweep so overdue members get `validTimeEnd` pulled back on MIPS (via `mips-access` revoke), and get automatically restored the moment the balance is cleared. Restore is fired from the payment path so it is instant, with the sweep as the safety net.

### 3. Overdue visibility
Show a clear "Access blocked — dues ₹X overdue since <date>" badge on the member profile, live access feed and check-in screen, plus a staff override (already present in the Live feed) that logs who overrode and why.

### 4. Member add-on purchase via payment gateway
- Add an online path to the add-on drawer: for members, create a Razorpay order through the existing `create-payment-order` (with the dynamic convenience-fee quote, never added to the invoice), leave the invoice `pending`, and let `payment-webhook` settle it and issue the benefit credits.
- `purchase_benefit_credits` gets a `p_defer_settlement` mode: create invoice + credits in a pending state and only activate credits on webhook confirmation. Cash/card at the desk keeps working exactly as today.
- Failure/abandonment leaves a pending invoice the member can retry from My Invoices.

## Technical notes
- New migration: fixed trigger function, `member_access_status()` helper, `validate_member_checkin` update, `dues_grace_days` in branch settings, `purchase_benefit_credits` deferred-settlement mode.
- Edge functions touched: `mips-webhook-receiver` (deny path), `mips-access` (dues revoke/restore reasons), sweep rule, `create-payment-order` / `payment-webhook` (add-on order type).
- Frontend: `PurchaseAddOnDrawer` (online pay option), member profile / live access feed badges.
