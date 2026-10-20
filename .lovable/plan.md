# Trainer dashboard: attendance sync and earnings redesign

## What the audit found (checked against live data)

**Issue 1: both clients show "Mark"**
- The dashboard shows two cards at once. "Today's PT attendance" comes from the automatic gate-scan system, and it already auto-marked Simpy Kaur at 19:37. "Mark Today's PT Sessions" is an older manual panel that lists every PT client with a "Mark" button, no matter what the auto system has done.
- The same manual "Mark" button also appears on each PT client on the My Clients page.
- Result: a trainer can double-mark a client, or mark a client present when the gate never saw them. That bypasses the auto-attendance and correction workflow the admin side uses.

**Issue 2: ₹500 per session on Earnings**
- The Earnings page multiplies completed sessions by the trainer's "hourly rate". Your trainer's rate is ₹0, so the page silently falls back to a hard-coded ₹500 per session. That ₹500 is invented: no rule in your payroll pays per session.
- The real commission rules (40% of the price before GST, GST deducted separately, paid in monthly instalments, released only when the invoice is fully paid) are ignored. Actual figures for this trainer:
  - **Simpy Kaur, Silver ₹10,000:** sale value before GST ₹9,523.81 × 40% = ₹3,809.52, minus GST deduction = **₹3,619.04**, payable this month (October).
  - **Sweety Arora, Silver ₹10,000:** commission **₹4,000**, but it is **on hold** because the member still owes ₹10,000.
- "Sales incentives" also loads from the wrong place (the sale record's release date instead of the monthly instalments), so totals don't match what payroll pays.

## What I'll build

### 1. Attendance follows the auto workflow
- Remove the duplicate "Mark Today's PT Sessions" card. "Today's PT attendance" becomes the single attendance card, listing every active PT client with one clear status:
  - **Auto-marked** (gate scans matched): shows times, plus a "Correction" button that sends the request to the manager.
  - **Waiting for scan** (client hasn't arrived yet): no button.
  - **Missed / mismatch** (client scanned but trainer wasn't on duty, or similar): "Request correction".
- Manual marking stays available only as a manager-approved correction, never as a direct "Mark" button. The same change applies to My Clients.
- A per-branch switch keeps the old manual "Mark" button for branches where the gate isn't live yet (default: off, so auto attendance is used).

### 2. Earnings page redesign (bento layout)
- **Top row:** This month's payout · Commission on hold (with reason, e.g. "Member dues ₹10,000") · Upcoming instalments · Sessions delivered.
- **Commission by client table:** client, package, sale value before GST, share %, GST deduction, net commission, instalment "1 of 1", status (Payable / On hold / Paid) with text and icon, not colour alone.
- **Sessions delivered:** a count and list for this month, with no ₹ amount per session (sessions don't earn money on their own).
- **Payout trend chart:** last 6 months of paid vs. pending, totalled on the server.
- **Salary card:** base pay, deductions, and net, using the official payslip when management has generated one, otherwise a clearly labelled "Estimate".
- Loading, empty, and error states, keyboard focus, and proper table headers.

### 3. Safety
- Every attendance correction request already goes to the manager approval log. No new money-writing paths are added: the earnings page only reads.

## Technical details
- New branch-guarded read-only `trainer_earnings_summary(p_month)` RPC (security definer, `rpc_guard_applies`, self-trainer or manager of branch). It returns instalments from `pt_commission_installments` joined to `trainer_commissions` and the PT invoice balance, plus a 6-month aggregate. EXECUTE goes to authenticated only.
- Remove the `hourly_rate || 500` fallback entirely.
- Dashboard: drop `TrainerTodayPanel`, extend `TrainerPtAttendanceCard` to show all active PT clients with the auto-log state from `pt_auto_attendance_log`. In `MyClients.tsx`, `MarkPtStatusMenu` is gated by the branch setting `pt_manual_mark_enabled` (default false).
- Add tests in `scripts/tests/` for: GST-exclusive commission (₹10,000 → ₹3,619.04 with GST deduction), on-hold status when invoice balance > 0, and no per-session amount.
- Update `AGENTS.md` with the rule: the earnings UI reads only instalments and never derives session pay.
