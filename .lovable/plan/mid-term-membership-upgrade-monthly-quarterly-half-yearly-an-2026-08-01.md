# Mid-term membership upgrade (Monthly → Quarterly → Half-yearly → Annual)

## What the audit found

- **There is no upgrade path today.** The member profile button says "Upgrade Plan" when a plan is still running, but the purchase drawer blocks the submit button whenever more than 7 days of cover remain (`canRenew`). So a mid-term upgrade is currently impossible from the UI.
- **Purchase always creates a brand-new membership + a brand-new invoice** via the `purchase_member_membership` RPC. When the member does have a plan expiring within 7 days, the new term is stacked *after* the old end date — correct for renewal, wrong for an upgrade.
- **No money ever moves between the old and new plan.** Nothing reads what the member already paid; there is no credit, no adjustment, no link between the two membership rows.
- **Cancel is the only "close the plan" path** and it issues a refund invoice — the wrong instrument for an upgrade.
- Right now no member holds two overlapping active memberships, so introducing a proper upgrade now avoids future data mess.
- Side finding: the server computes the end date as `start + duration_days - 1`, while the frontend uses calendar-month math (`membershipEndDateISO`). For a 31 Jul start these disagree. The upgrade work will use the shared calendar helper on the server so both agree.

## How the upgrade will work

Using your example — ₹5,000 monthly plan, upgraded on day 8 to a ₹25,000 annual plan:

```text
Old membership   Monthly  ₹5,000 paid   start 01 Jan   end 31 Jan
Upgrade on 08 Jan to Annual ₹25,000
  Credit applied      ₹5,000   (everything already paid, not a per-day rate)
  Member pays         ₹20,000
New membership   Annual   start 01 Jan (unchanged joining date)   end 31 Dec
  Days remaining      358
Old membership row → status 'upgraded', closed on 08 Jan
```

Rules:
- **Credit = total already paid on the running plan.** No per-day proration.
- **Start date never moves.** The new term runs from the original joining/start date for the new plan's full duration, so remaining days naturally become `duration − days already used`.
- Gift days and freeze days already granted on the old membership carry over onto the new end date.
- If the credit is greater than or equal to the new plan price (a downgrade), the action is blocked with a clear message — downgrades stay on the cancel + repurchase path.

## Invoice handling

The **same invoice is amended** — same invoice number, payments carry over, balance becomes due. It will be itemised so staff and the member can read the whole story on one document:

```text
INV-INC-26-00XX                                   (unchanged)
  1. Annual Plan - 365 days (01 Jan – 31 Dec)          25,000.00
  2. Upgrade credit — Monthly Plan (01–08 Jan, paid)   −5,000.00
  ------------------------------------------------------------
  Total                                                20,000.00
  Already paid                                          5,000.00   <- carried over
  Balance due                                          20,000.00
```

- GST is recomputed on the revised total using the plan's inclusive/exclusive setting, so the tax invoice stays correct.
- Invoice notes record the upgrade: from plan, to plan, credit amount, actor, timestamp.
- The old membership's invoice reference and the credit line both point at the old membership id, so reporting can trace it.
- Reminders for the new balance are rescheduled; stale reminders for the old amount are cancelled.

## What gets built

1. **`upgrade_membership` RPC** (atomic, idempotent, capability-gated like the other membership RPCs):
   - locks member, old membership, old invoice
   - validates the new plan is higher value than the credit and the old plan is active (not frozen, not cancelled)
   - closes the old membership as `upgraded`
   - creates the new membership with the original start date and calendar-correct end date, carrying gift/freeze days
   - rewrites the existing invoice's line items and totals, recomputes GST, keeps `amount_paid`, resets status to paid/partial/pending
   - reschedules payment reminders, writes a lifecycle event + audit entry, re-evaluates hardware access
2. **`UpgradeMembershipDrawer`** (right-side sheet, Vuexy styling) opened from the member profile "Upgrade Plan" button and from Member Plans: plan picker showing only higher-value plans, a live breakdown (current plan, paid so far, new plan price, credit, amount to pay, new end date, new days remaining), payment method + full/partial payment, and a reason field.
3. **Unblock the flow**: the purchase drawer's 7-day gate stays for *renewals*; upgrades route to the new drawer instead of being disabled.
4. **Membership card + invoice drawer** show an "Upgraded from <plan>" chip and the credit line so history is visible.

## Technical notes

- New enum value `upgraded` on `membership_status`, plus `upgraded_from_membership_id` and `upgrade_credit_amount` columns on `memberships`.
- Server-side end-date math moves into a SQL helper mirroring `src/lib/memberships/duration.ts`, and `purchase_member_membership` switches to it so purchase, renewal and upgrade agree.
- Payment for the upgrade balance goes through the existing `settle_payment` path — no new payment writer.
- Frontend touches: `MemberProfileDrawer.tsx`, `MemberPlans.tsx`, new `src/components/members/UpgradeMembershipDrawer.tsx`, `src/services/membershipActionsService.ts`, `MemberInvoicesDrawer.tsx`.
- Downgrades and frozen memberships are explicitly rejected by the RPC with named errors.
