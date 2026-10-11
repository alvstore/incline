# Gate Access 3-Tier Protocol (Red / Amber / Green) + Store and Add-on Debt Rules

## What we found (checked against live data)

- The gate decides entry with one check, `member_access_status`. It adds up **every** overdue unpaid bill: membership, personal training, store orders and add-ons. If anything is overdue past the grace days, the member is **refused at the turnstile**.
- That breaks your rule. Right now there are 5 unpaid PT bills (₹1,35,500) and 5 unpaid membership bills (₹66,000). A member who owes only PT can be refused at the gate today.
- Each bill line already records what it was for (membership, PT package, product, add-on). So we can split debts by type without changing old bills.
- Gate refusals already alert the desk, but they do it by writing directly to everyone's notifications, across all branches. Nothing is recorded as an audit event, and nothing is deduplicated.
- The tables named in the brief (`attendance_logs`, `pt_session_settlements`) don't exist. The real ones are `access_logs`, `member_attendance`, `invoices`/`invoice_items` and `pt_commission_installments`. The app is React + Vite, not Next.js. The receiver is the existing `mips-webhook-receiver`, so there is no new `mips-facial-auth` function.

## The rule, per type of debt

| Debt type | Gate | Digital lock | Desk alert |
|---|---|---|---|
| Membership expired / frozen / cancelled / overdue membership bill | RED: deny | All bookings | Denied alert |
| Overdue PT package bill | AMBER: open | New PT booking and PT purchase locked; existing sessions still auto-mark | Amber alert |
| Overdue store order (member self-checkout) | AMBER: open | Store checkout and new add-on purchase locked until paid | Amber alert |
| Overdue add-on (sauna / ice bath / scan packs) | AMBER: open | That add-on's facility bookings locked; other benefits fine | Amber alert |
| Nothing overdue | GREEN: open | None | None |

Rules that keep this solid:
- **An unpaid online order is not a debt.** Member store and add-on bills that were never paid stay "awaiting payment". They expire as they do today and never count towards Amber. Only staff-issued bills with a due date count.
- **Add-on credits only activate once the bill is fully paid** (this already holds). Amber blocks buying more while one is overdue.
- **Store stock** is reserved only when payment succeeds. Abandoned orders release nothing.
- **Fail-closed stays for RED.** If the check errors, the gate keeps today's behaviour (deny). Amber never fails open into a RED decision.

## Flow from face scan

```text
MIPS face scan -> relay (HMAC) -> mips-webhook-receiver
  1. resolve person (existing hierarchy)
  2. rpc gate_access_decision(member, branch) -> {tier, reasons[], base_due, pt_due, store_due, addon_due}
  3. RED   -> respond deny, log access_logs(result=member_denied, tier=red), desk alert
     AMBER -> respond allow, member_check_in, log tier=amber, upsert front_desk_alerts (1 per member/day)
     GREEN -> respond allow, member_check_in, log tier=green
  4. front_desk_alerts insert -> Realtime (branch-scoped topic) -> Front desk bento feed
```

The webhook response format to the relay stays unchanged (allow/deny). The tier is recorded in our database only.

## Epics

### Epic 1: Database and gate (backend)
- New function `gate_access_decision` that classifies overdue amounts by bill type and returns the tier. `member_access_status` is kept as a thin wrapper, so `sync-to-mips`, `mips-access` and `member_check_in` work the same way, and its "allowed" answer now means "not RED".
- `evaluate_member_access_state` and the hardware revocation (2000-01-01) run **only on RED causes**. Overdue PT, store or add-on bills no longer revoke the face on the terminals. Members currently revoked only for PT dues get restored in one guarded pass. We list them for you first, before restoring.
- New table `front_desk_alerts` (branch, member, tier, reasons, amounts, status: open / acknowledged / resolved, acknowledged_by, day key unique per member, branch and day). Branch-scoped read rules for staff. Realtime on a private branch topic. A resolve RPC with an audit log entry.
- New function `member_debt_locks(member)` returns which digital actions are locked. Booking and purchase RPCs check it on the server (`book_facility_slot`, `book_class` for PT-type, store checkout, add-on purchase, `request PT`). The client lock is cosmetic only.
- **Audit:** every tier decision that is not GREEN writes an append-only `audit_logs` entry (actor = system, entity = member, metadata = tier and amounts, no face data). Acknowledge and resolve actions log the staff member.
- **Feature flag:** `settings.gate_tier_mode` per branch, with the values `legacy` (today's behaviour), `shadow` (compute and log the tier, gate unchanged) and `enforce`. We roll out legacy → shadow for 2–3 days, compare the outcomes, then switch to enforce. The kill switch is one setting, with no new release needed.
- Gate refusal alerts are moved into the same table and scoped to the branch (today they go to every branch's staff).
- Tests: tier classification for each debt type, the expired-online-order exclusion, grace days, and the flag modes.

### Epic 2: Front desk (staff)
- A "Gate alerts" bento card on the dashboard and attendance page: live Amber/Red feed with the member photo, tier badge (amber and destructive tokens, plus icon and text, never colour alone), a breakdown of what is owed, and Collect payment (opens the existing payment drawer) / Acknowledge buttons.
- An `aria-live="polite"` region for new alerts and a soft sound through the existing audio singleton (no new audio path). Keyboard reachable, with 44px targets.
- An in-app notification goes through `dispatchCommunication` (no direct inserts). There is **no WhatsApp/SMS to the member at the gate**, to avoid embarrassment at the turnstile.

### Epic 3: Member app
- A "Payment needed" bento card that says what is due and why (PT / store / add-on), with a Pay now button using the existing Razorpay order flow on the real bill.
- Locked buttons (Book PT, buy add-on, store checkout) show the reason and a pay link instead of failing.
- Once payment is confirmed (by the webhook only), the locks and the open alert clear automatically, and the gate tier returns to GREEN on the next scan.
- Shaped by: accessibility-pass, feature-flags-and-toggles, audit-logging-backend, email-and-notifications, edge-functions-and-webhooks.

## Verification
- Shadow mode on today's scans: compare old vs new decisions and report the members who would now enter.
- Test members: one PT-only overdue (enters, Amber alert shows, PT booking locked), one membership-overdue (denied), one store-only overdue (enters, checkout locked), and one abandoned online order (Green).
- Pay a PT bill by Razorpay in test mode: the lock clears and the alert resolves.

## Technical details
- Classification uses `invoice_items.reference_type`: `membership` → base, `pt_package` → PT, product/store types → store, benefit add-on types → add-on. A mixed bill splits proportionally by line total.
- All new SECURITY DEFINER functions use `rpc_guard_applies()` plus a branch or own-member check, with explicit GRANTs and EXECUTE revoked from PUBLIC. They must pass `check-definer-guards.ts`. RLS uses `(SELECT …)`-wrapped helpers.
- Webhook stays idempotent: the alert upsert uses the unique day key, and the access log keeps metadata only (`stripScanMedia`).
- AGENTS.md gets a rule: "Gate denies only for base-membership causes; secondary debts are Amber (digital locks + desk alert)".

Do you approve this architecture plan? If yes, I will begin writing the code for Epic 1.
