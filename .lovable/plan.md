# Money Movement Console — Expenses, Bills & Salary Advances

Rebuild `/payments` into a single money-in / money-out console and close the gaps in the expense workflow: payment mode, editing with audit, vendor bills, and staff salary advances that flow into payroll.

## What's there today (verified)

- `expenses` table has: branch, category, amount, description, vendor, receipt_url, date, status (pending/approved/rejected), submitted_by, approved_by. **No payment method, no paid date, no bill number, no employee link.**
- `AddExpenseDrawer` submits pending expenses only — no edit path anywhere in the app.
- `/payments` (`Payments.tsx`) shows only income: KPIs, dues collection card, recent payments table. Expenses live on a separate Finance page tab.
- Payroll already has `payroll_items.final_advance` as a manual deduction field — no advance ledger feeding it.

## Money Out — expense workflow

**Add Expense drawer** gains:
- Expense type: General · Vendor Bill · Salary Advance (drives the rest of the form)
- Mode of payment (Cash / UPI / Card / Bank transfer / Cheque / Other) + reference number
- Paid on date (separate from expense date)
- Vendor Bill: bill/invoice number field, paid-or-unpaid marker (single record — no instalments)
- Salary Advance: staff picker instead of vendor, plus "recover in next payroll" toggle

**Edit Expense** — owner/admin can edit any expense; a mandatory reason is captured and every change is written to the audit log with who/what/when. Previous values stay visible in the expense's history panel.

**Approve/Reject** stays where it is; approving now also stamps who paid it and how.

## Salary advances

New `salary_advances` ledger: staff member, amount, paid date, mode, reason, outstanding balance, status.

- Recording an advance creates both a ledger row and the linked expense entry — one action, no double entry.
- Payroll: outstanding advances auto-populate `final_advance` for that staff member in the next run; the operator can override the amount or clear it manually (both paths supported).
- When a payroll run is finalised, the deducted amount is applied against the ledger and the advance is marked recovered (fully or partially).
- An "Advances" view lists every advance with outstanding balance and recovery history.

## /payments redesign — money movement console

One page, one filter bar, one export, five tabs:

```text
Overview   Income   Expenses   Advances   Dues
--------------------------------------------------
[ Money In  ₹ ]  [ Money Out ₹ ]  [ Net ₹ ]  [ Outstanding Dues ₹ ]
[ Search ........ ] [ Date range ] [ Method ] [ Status ] [ Clear ]
```

- **Overview** — in/out/net KPI row, today vs period toggle, split of collections by mode (cash/UPI/card/bank), top expense categories, quick actions (Record Payment · Add Expense · Pay Advance).
- **Income** — existing payments table, unchanged behaviour (edit/void preserved).
- **Expenses** — parity with the income table: date, category, vendor/staff, amount, mode, status badge, bill no., receipt link, Edit action. Filters: date range, category, mode, status, search.
- **Advances** — outstanding advances by staff with recovery progress.
- **Dues** — the existing dues collection card, promoted to its own tab.

Shared filter state across tabs; Export respects the active tab and filters.

## Technical notes

- Migration: extend `expenses` with `expense_type`, `payment_method` (`payment_method` enum), `payment_reference`, `paid_at`, `paid_by`, `bill_number`, `is_paid`, `employee_user_id`, `edit_reason`. New `salary_advances` table with GRANTs + RLS scoped by branch and role (owner/admin full, manager branch-scoped, staff read-own).
- Expense writes move behind an atomic `record_expense` / `edit_expense` RPC so the expense, the advance ledger row, and the audit entry commit together.
- Payroll integration via a `pending_advance_for_user()` helper read by `PayrollRunPanel`, and a finalise-time hook that decrements the ledger.
- Frontend: rework `Payments.tsx` into the tabbed console (existing income/dues code reused, not rewritten), extend `AddExpenseDrawer` with the new fields, add an `EditExpenseDrawer`. Expense tables live in `src/components/finance/`. No new pages, no new routes.
- All queries TanStack Query, branch-scoped, with skeleton/error/empty states; drawers only (no dialogs) per the form standard.
