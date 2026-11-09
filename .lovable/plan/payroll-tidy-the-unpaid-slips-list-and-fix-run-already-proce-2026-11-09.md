# Payroll: tidy the unpaid-slips list and fix "Run already processed" on save

## What the audit found
1. **Why the list is huge.** There are 36 unpaid slips from earlier months: May 5, July 8, August 11, September 12. Most are old calculations that were never paid in the app (you probably paid them outside it). The card lists every one, one by one, at full height, above the payroll table.
2. **Why saving Bhagirath's salary fails.** The October run was marked "Paid" because 6 of 7 people were paid. The save step checks whether the whole *run* is paid, not whether *this person's slip* is paid. So any slip left unpaid in a paid run can never be saved. That's the "Run already processed; cannot adjust" message.

## What I'll change
### A. Unpaid slips card (compact)
- Collapsed by default to one line: "36 unpaid slips from earlier months · ₹2,99,148". Press **Review** to open it.
- When open, it's grouped by month (September · 12 slips · ₹1,37,396). Each month expands to show its people.
- Each month gets **Open month** (switches the page to that month so you can pay it) and **Discard month** (a confirm box that says how many slips and the total).
- A single slip can still be discarded on its own.
- It hides itself when there's nothing to show, and shows a retry message if loading fails.
- Discarding goes through a server action that records who did it and why. It never touches paid slips and never touches PT commissions, so discarded commissions stay due to be paid later.

### B. Saving a slip in a paid run
- The save and adjust checks will look at the **slip's own status**: they're blocked only when that slip is saved or paid.
- After a slip is saved, the run's status is worked out again ("Paid" only when every slip in it is paid). That stops the October run showing "Paid" while Bhagirath is unpaid.
- Then you can finish Bhagirath: Save salary, then Record payment with the UTR (₹78,166.67).

## Technical details
- Migration: replace the run-status guard in `payroll_adjust_item` (and the same check in `payroll_prepare_item`/`payroll_recalculate_item` if present) with an item-status guard. Add `payroll_sync_run_status(run_id)` called after prepare/pay.
- New RPC `payroll_discard_slips(p_item_ids uuid[], p_reason text)`: owner/admin, branch-guarded, only for draft/approved items, writes to `payroll_audit`. `DraftSlipsCard` uses it instead of a direct table update.
- `DraftSlipsCard`: Collapsible, grouped by month, an "Open month" callback to `PayrollRunPanel`, loading/error/empty states, 44px buttons, aria-expanded.
- Test: month grouping and totals helper.
