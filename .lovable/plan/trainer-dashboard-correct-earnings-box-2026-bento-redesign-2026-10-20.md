# Trainer dashboard: correct earnings box + 2026 bento redesign

## What I found (live data)
- Simpy Kaur's trainer is now correct in the database: ₹10,000 × 40% = ₹4,000, minus 5% = **₹3,800** (Simpy payable, Sweety on hold).
- Another trainer (Bhagirath Gurjar) still has commissions with **no 5% cut taken**: four October sales show ₹6,000 / ₹6,000 / ₹4,000 / ₹5,500 with GST deduction ₹0. These should be ₹5,700 / ₹5,700 / ₹3,800 / ₹5,225. That is why the "My Earnings" box can still look wrong.
- The dashboard box shows only "payable + paid" and hides money on hold, with no breakdown, so a trainer can't see why the number differs from what they expect.
- The same earnings figure is repeated twice (banner and stat row).

## What I'll do

### 1. Fix the money (backend, one source of truth)
- First confirm whether the 5% trainer cut applies to every trainer or only some (if there's a per-trainer setting, honour it).
- Correct existing commissions and their monthly instalments where the 5% cut was skipped, only for unpaid ones; paid ones are left alone and listed for you.
- Every correction is written to the audit log.
- Payroll, the Earnings page and the dashboard all read the same corrected instalments.

### 2. Redesigned trainer dashboard (bento, theme tokens only)
```text
[ Greeting + duty status (punch in/out, last seen gate)      ][ Earnings KPI: payable, on hold, sparkline ]
[ KPI: PT clients ][ KPI: Sessions today ][ KPI: Classes this week ][ KPI: Attendance rate ]
[ Today's PT attendance (auto)                ][ My tasks (compact widget)                  ]
[ Classes by date                             ][ My clients                                  ]
[ Week roster                                                                                ]
```
- **Earnings KPI card:** big net payable this month, smaller "on hold ₹X (member dues)", upcoming, and a 6-month sparkline. Taps through to Earnings.
- **KPI cards:** value + small change vs last week + mini trend where meaningful.
- One earnings figure only (removed from the banner).
- Theme colours only, works in light and dark; no glows or heavy shadows.
- Loading skeletons, empty and error states on every card; works at phone width with no sideways scroll; 44px touch targets.

### 3. Check
- Design review at desktop, tablet and phone sizes, signed in as a trainer.
- Tests: ₹10,000 at 40% nets ₹3,800; ₹12,000 at 50% nets ₹5,700; on-hold amounts never counted as payable.

## Technical details
- Data fix via migration: for `trainer_commissions` where `gst_deduction = 0` and not paid, set `gst_deduction = base_commission × rate`, `net_total_commission`/`amount` = base − deduction, and update linked `pt_commission_installments.installment_amount` (split evenly by count) where status <> 'paid'. Rate read from the same HR/payroll setting `generate_pt_commission` uses. Audit rows logged.
- Verify `generate_pt_commission` applies the deduction regardless of the member invoice's GST.
- Dashboard: new `TrainerEarningsKpi` and `KpiCard` components using `trainer_earnings_summary` (installments + trend, already server-aggregated); Recharts sparkline with `hsl(var(--primary))`; reuse compact `TaskPulseWidget` style.
- Tests added to `scripts/tests/trainerEarnings.test.ts`.
