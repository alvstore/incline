# PT commission, payouts and attendance — audit findings and fix

## What the audit found (verified against the live database and the sheet)

**Sheet decoded (8 sales, 27 Jul – 10 Aug 2026, total ₹2,20,500)**
Commission = sale amount × trainer share. GST column is a flat 5% deduction applied only to non-cash (UPI) sales. Net = commission − that deduction. Monthly payroll = net ÷ plan months. Every trainer share in the sheet already matches the trainer profile in the system (Ritesh 40, Bhagirath 50, Harshwardhan 40, Govind 40), so the share comes from the trainer profile — no per-sale override is needed.

**Live state**
- `trainer_commissions` is empty, `pt_commission_installments` is empty, and the only PT package row is a reversed one. None of the 8 sales exist in the system.
- Sale prices in the sheet (₹24,000 / ₹60,000 / ₹18,000 / ₹9,000 / ₹36,000 / ₹27,000 / ₹37,500) do not match the four catalogue packages (₹10,000 / ₹12,000 / ₹18,000 / ₹45,000). These were negotiated prices, so the backfill has to carry a custom price per sale.
- `generate_pt_commission` computes base/GST/net and monthly tranches correctly, but it schedules every tranche as payable regardless of outstanding dues. Under your rule (hold everything until the member has paid in full) it currently over-pays: Surendra ₹45,000 due, Ravi ₹27,500 due and Hozefa ₹21,000 due would all release money this month.
- `log_pt_session` checks role only. Any user with the trainer role can mark attendance for **any** member's PT package, including another trainer's client. The RLS policy on `pt_sessions` has the same hole.
- Nothing releases a held commission when the member later clears the dues — there is no payment-side hook onto the instalments.

## What will be built

### 1. Dues-gated commission payout
- Add a `blocked` state to PT commission instalments. `generate_pt_commission` creates the monthly schedule as today, but marks every tranche blocked while the linked PT invoice has any balance outstanding.
- When a payment settles the PT invoice in full, a trigger releases the whole schedule: past-dated tranches become immediately payable in the current payroll month, future tranches go back on schedule.
- `pt_commission_due_for_period` (the function payroll reads) counts only released tranches, so a trainer is never paid on money the gym has not collected.
- Voiding or refunding a PT payment re-blocks the unpaid tranches through the existing reversal path.

### 2. Trainer attendance — hard scoping
- `log_pt_session` gains an ownership check: a caller whose only role is trainer may mark attendance solely for packages where they are the assigned trainer. Owner, admin and manager keep full marking rights, including retroactive correction, and every mark is written with the acting user for audit.
- The `pt_sessions` RLS policy is tightened to the same rule so the block holds even outside the RPC.
- Session-based packages keep the depleting counter; monthly packages are marked per-day against the active window (no counter), which is how all four of your current packages are configured.

### 3. Attendance surfaces
- **Trainer** (`/my-clients`, Trainer Dashboard): only assigned PT clients appear, one-tap Present / Late / Absent / Holiday for today, and a read-only history of their own marks.
- **Staff / manager / owner** (Personal Training page, Attendance tab): full branch roster of active PT clients, ability to mark or correct any date within the package window, with the correction reason recorded.
- Each row shows plan, trainer, package type, days remaining or sessions remaining, and sessions marked this month.

### 4. Historical backfill of the 8 sales
For each row of the sheet, created inside one transaction per sale:
- a PT package on the member at the negotiated price, dated from the sheet's sale date, with the correct plan length;
- an invoice — cash sales as non-GST, UPI sales as 5% GST-inclusive, matching how the system already bills;
- a payment for the amount actually collected, leaving the balance open where the sheet shows dues;
- a commission record with base, GST deduction and net, plus the monthly instalments, blocked where dues remain.

Member and trainer mapping used:

| Sale | Member | Trainer | Amount / Paid | Mode |
|---|---|---|---|---|
| 27 Jul | KAUSHAY JAIN (INC-26-0007) | Ritesh 40% | 24,000 / 24,000 | UPI |
| 27 Jul | Surendra Chundawat (INC-26-0102) | Bhagirath 50% | 60,000 / 15,000 | Cash |
| 29 Jul | Preeti Dewani (INC-26-0041) | Harshwardhan 40% | 18,000 / 18,000 | UPI |
| 1 Aug | Sandeep (INC-26-0060) | Bhagirath 50% | 9,000 / 9,000 | Cash |
| 3 Aug | Hozefa Bohra (INC-26-0071) | Bhagirath 50% | 36,000 / 15,000 | Cash |
| 10 Aug | Krishna Sachdev (INC-26-0086) | Govind 40% | 27,000 / 27,000 | Cash |
| 10 Aug | Ravi Jain (INC-26-0085) | Bhagirath 50% | 37,500 / 10,000 | Cash |
| 10 Aug | Dr Ritika Jain (INC-26-0054) | Bhagirath 50% | 9,000 / 9,000 | Cash |

Under your dues rule the three part-paid sales (Surendra, Hozefa, Ravi) carry a held commission that unlocks automatically the day the member clears the balance — this differs from the sheet, which pays Hozefa and Ravi monthly despite dues.

### 5. Payroll and ledger visibility
- The Commissions ledger gains a payout status per tranche: **Held (dues ₹x)**, **Due this month**, **Paid in <run>** — so a trainer asking "why wasn't I paid" has a visible answer.
- Payroll runs pick up released tranches only; a held tranche shows in the trainer's earnings screen as awaiting collection with the exact outstanding amount.

## Technical notes

- Migrations: add `blocked` to the instalment status set with a `blocked_reason`; rewrite `generate_pt_commission` to compute the paid ratio from the linked invoice and set instalment state; new `release_pt_commission_on_payment(invoice_id)` called from the payment-settled trigger and re-blocked from `void_trainer_commission` / `reverse_trainer_commission`; rewrite `pt_commission_due_for_period` to filter released tranches; ownership guard inside `log_pt_session`; replace the `Staff manage pt sessions` policy with a trainer-scoped variant.
- Backfill runs as data statements through the existing `create_manual_invoice` / `record_payment` paths so the money lands in the same ledger as everything else — no direct table writes for invoices or payments.
- Frontend: `src/pages/PTSessions.tsx` (attendance + commissions tabs), `src/components/pt/PtAttendanceTabContent.tsx`, `src/components/pt/CommissionLedger.tsx`, `src/components/pt/TrainerTodayPanel.tsx`, `src/pages/MyClients.tsx`, `src/pages/TrainerEarnings.tsx`. Sheet-only drawers, Vuexy cards, branch-scoped queries, `can.*` gating throughout.
