# Payment received date for PT package purchases

## Problem
The Personal Training purchase drawer has no "Payment received on" field. The server records every PT invoice and payment with today's date, so backdated sales (like Shambhay Singh Sisodia's ₹10,000 date correction) can only be fixed by voiding and re-entering, which still lands on today.

## What changes
- **Drawer:** add a "Payment received on" date field (default today, no future dates, limit e.g. 90 days back) shown next to payment method/amount; hidden when amount paid is 0. Helper text: "Invoice and receipt will use this date." Package start date stays separate.
- **Server:** `purchase_pt_package` accepts an optional received date; invoice date and payment date use it (via the existing dated `record_payment` variant). Server rejects future dates and dates older than the limit; managers/staff only (members never call it).
- **Audit:** backdated purchases write an audit entry ("PT payment backdated to 03 Nov 2026 by Rajat") with original vs chosen date; shown readably in Audit Logs.
- **Switch:** branch setting `pt_backdate_payments` (on by default for owner/admin/manager; off hides the field and server falls back to today).
- **Existing data:** list Shambhay's voided/corrected PT payment and other PT payments from the date-change workaround; correct the replacement payment's date only after you confirm the real received date.

## Technical details
- Audit `PurchasePTPackageDrawer.tsx`, `ptService.ts`, `_purchase_pt_package_impl` for every place `now()`/`CURRENT_DATE` sets invoice/payment dates; check commission installment month follows received date (payroll month correctness).
- Migration: add `_payment_date date DEFAULT NULL` to both functions (drop/recreate preserving grants and `rpc_guard_applies` checks), date bounds check, audit_logs insert when date ≠ today.
- Tests: date-bound rules (future rejected, >limit rejected, today default) and drawer payload.
