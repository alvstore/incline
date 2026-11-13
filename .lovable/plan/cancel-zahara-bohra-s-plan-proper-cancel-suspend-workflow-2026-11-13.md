# Cancel Zahara Bohra's plan + proper Cancel / Suspend workflow

## What I found
- **Zahara (INC-26-0220):** plan 20 Oct 2026 to 19 Apr 2027, bill BOS-INC-26-0119 for ₹18,000, with a ₹1 "cash" payment that was **never actually received**. Someone entered it only because the app won't start a plan with ₹0 paid.
- **The ₹0 glitch:** "Part payment" needs at least ₹1 now, and a plan only starts after some payment comes in. So staff can't start a plan "on credit" without making up a fake ₹1.
- **Cancel already exists, but it's hidden and has bugs:**
  - It's only inside the member panel (Plan tab). The Members list menu has no Cancel or Suspend.
  - A refund is worked out from the plan's full price, not the money actually received. So it could offer to refund money never collected (for example, a prorated refund on Zahara's ₹1 bill).
  - It only closes bills with ₹0 paid. A part-paid bill like Zahara's stays open, and her ₹17,999 keeps showing as due after cancellation.
  - It doesn't ask what to do with the unpaid balance or with money already paid.
- **Suspend:** there is no suspend workflow at all.

## 1. Zahara now (one-off data fix)
- Reverse (void) the fake ₹1 payment, with the note "never received; placeholder".
- Cancel the plan with the reason "Non Payment" and refund ₹0. Close the ₹18,000 bill as written off, so she owes nothing.
- Gate access is removed by the existing access rules.

## 2. Cancel workflow (new side panel, same atomic server step)
Open it from the Members list menu ("Cancel plan") and from the member panel. It walks through:
1. **Reason (required):** Non payment, Relocating, Medical, Not satisfied, Joined by mistake, or Other with a note.
2. **Bill summary:** total, actually received and still due, worked out from real payments.
3. **Unpaid balance (if any):** "Write off and close bill" or "Keep as due".
4. **Money received (if any):** "Keep, no refund", "Refund full received", "Refund prorated (capped at received)" or "Custom (capped at received)", plus the refund method.
5. **Effective:** immediately (access removed now).
6. **Review screen:** shows exactly what happens before you confirm.

## 3. Suspend workflow
- Members list menu and member panel get "Suspend member", with a required reason.
- Suspending sets the member to Suspended, cancels and removes the current plan (as you asked: "suspend and delete the plan for now"), blocks the gate, and uses the same unpaid-balance and refund choices as Cancel.
- "Lift suspension" puts the member back to Inactive, ready to sell a new plan. It never restores the old plan automatically.

## 4. Fix the ₹0 glitch
- In the plan sale panel, add a "Start now, pay later (₹0 today)" option. It needs a due date and a note, and it is limited to owner/admin/manager.
- The plan starts straight away with the full amount due, so no fake ₹1 payments are needed. The existing gate rules still show dues as an amber desk alert.

## 5. Rollout and checks
- **On/off switch:** a per-branch "New cancel/suspend workflow" switch, on by default. Turning it off falls back to the current cancel panel.
- **Accessibility:** proper labels on every field, a required marker, reason errors linked to their field, radio groups for each choice, Escape closes, and focus returns to the menu.
- **Tests:** refund can never exceed money received; write-off closes the bill; keep-due leaves the balance; suspend removes the plan.
- **Ready-to-send message:** a short, polite message you can send Zahara about the cancellation.

## Technical details
- Migration: extend `cancel_membership` with `p_balance_action text DEFAULT 'keep'` ('write_off' sets linked open invoices to cancelled with an audit note, including part-paid ones) and clamp `p_refund_amount` to the sum of completed payments on linked invoices (server error if higher). The RPC stays backward compatible.
- New `suspend_member(p_member_id, p_reason, p_balance_action, p_refund_amount, p_refund_method)` RPC: calls cancel logic for active/pending memberships, then sets `members.status='suspended'`, goes through `transition_member_lifecycle`, and is guarded by `rpc_guard_applies` + branch + `cancel_membership` capability. Also new `lift_member_suspension`. EXECUTE granted to authenticated.
- `purchase_membership`: accept `p_start_on_credit boolean`, activating with 0 paid when the caller's role is allowed (server-checked).
- Zahara: void the payment via `reverse_payment`, then call cancel with write_off (run as data change).
- UI: rewrite `CancelMembershipDrawer` (stepped Sheet), new `SuspendMemberDrawer`, Members list menu items gated by `can.cancelMembership(roles)`, and a flag in branch settings `membership_actions_v2`.
