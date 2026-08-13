# Six fixes: joined dates, duplicate gift button, logout on set-password, real plan revoke, dr-replicate timeout, and the PT commission engine

## 1. Wrong "Joined" date (01 Jan 1970)

Verified: every one of the 104 members has a valid `joined_at` in the database (earliest 24 Jun 2026). The 1970 date is a display bug — when a member is opened from **search results**, the list code sets `joined_at: null`, and the profile drawer formats that null straight through `new Date(null)`, which is 1 Jan 1970.

Fix:
- Populate the real joined date in the search-result mapping instead of `null`.
- Guard the drawer so a missing date renders "—" rather than an epoch date, matching how the members table already guards it.

## 2. Duplicate "Gift Days" button

The member profile shows both **Comp / Gift** and **Gift Days**, which do overlapping things. Remove the "Gift Days" button and its drawer wiring from the profile, keeping Comp/Gift as the single path. The underlying free-days function stays intact (it is used by the comp engine).

## 3. Logout after public registration

After self-registration a member lands on the set-password screen with no way out. Add a "Sign out" action in that screen's header so anyone who lands there by mistake can leave.

## 4. Revoke does not actually revoke a diet/workout plan

Verified: revoke sets `valid_until = today`, so the plan stays valid for the rest of the day and still shows to the member. Change revoke to end the plan immediately — set `valid_until` to yesterday and stamp a revoked marker — and make the trainer/member-facing plan lists treat that as ended, so the plan disappears from "My Diet" / "My Workout" straight away.

## 5. dr-replicate 504

The replication function mirrors schema, auth, rows and storage in a single request, which exceeds the gateway timeout as the database grows. Rework it to run in resumable phases (schema → auth → rows in table batches → storage), returning progress after each phase and continuing on the next invocation, with the DR Readiness page driving the loop and showing phase progress.

## 6. Personal Training: sales, commission deferral and payroll

Current state (verified): four monthly PT plans, all 5% GST-inclusive; trainers already carry `fixed_salary` and `pt_share_percentage`; payroll lines already have a `calc_pt_commission` slot; there is exactly one PT sale in the system and it is reversed, so there is no live data to migrate.

### Sale
- "Sell PT" available directly from the PT dashboard (member picker inside the drawer) and from the member profile.
- Fields: plan, trainer, start date (backdating allowed like memberships), duration in months, **editable negotiated price** with the catalogue price as default, payment mode, amount paying now, due-date presets, UTR/reference for UPI/bank.
- Calendar-correct expiry (3 months from 31 Jan lands on the calendar date, not +90 days).
- Invoice, dues and payment go through the existing atomic payment/invoice path.

### Commission (locked at sale, paid in monthly installments)
- Base commission = full negotiated sale value × trainer's `pt_share_percentage` — locked at sale, regardless of pending dues.
- If payment mode is anything other than cash (UPI, card, bank, gateway), deduct 5% of the base commission as GST; cash deducts nothing.
- Net commission = base − GST deduction, split into equal monthly installments across the plan duration, scheduled from the sale month forward.
- Reversal of a sale reverses the unpaid installments.

### Commission ledger (new page)
High-density table mirroring your spreadsheet: Date · Member · Plan (months) · Trainer · Total Amount · Paid · Due · Comm % · Mode · Base Comm · GST · Net Comm, with month/trainer/branch filters and CSV export.

### Payroll
The monthly payroll run picks up that month's pending PT installments per trainer and puts them in the existing PT-commission column, so the payroll screen shows Base Salary + PT Installments = Total Payout. Marking the run paid marks those installments paid.

No historical sales will be imported — the system starts fresh.

## Technical notes

- Migration: `pt_commission_installments` table (commission_id, trainer_id, payout_month, amount, status) with grants + RLS; extend `trainer_commissions` with sale-level fields (plan_duration_months, total_sale_amount, payment_mode, base_commission, gst_deduction, net_total_commission); a trigger/RPC on PT sale that computes base → GST → net and amortises the installments; `renew_pt_package`; calendar-month expiry helper; `compute_payroll` reads installments for the run month.
- Frontend: `src/pages/Members.tsx`, `src/components/members/MemberProfileDrawer.tsx`, `src/pages/SetPassword.tsx`, `src/services/fitnessService.ts` + plan lists, `src/services/mipsService.ts`-style phased driver for `DRReadiness.tsx`, `supabase/functions/dr-replicate/index.ts`, plus new `SellPTPackageDrawer.tsx`, `CommissionLedger.tsx` and payroll wiring.
- All new drawers follow the Sheet-only rule and Vuexy card styling; queries stay branch-scoped, role-gated via `can.*`, and use TanStack Query with loading/error/empty states.
