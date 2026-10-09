# Wallet top-ups and referral credits

## What "amount / credit" means
A member's **wallet** holds money they can spend on bills (store, add-ons, renewals).
- **Credit** = money added to the wallet (top-up, referral reward, refund to wallet).
- **Debit** = money taken out when they pay for something.
- **Amount** = how much is added or taken in that one entry.

## Wallet top-ups — already fixed
Done in the last security round: front-desk staff can **no longer** add money. Only the owner, admins, or that member's branch manager can, and every top-up goes through one checked server step that keeps a record. Staff can still *spend* from a wallet at checkout. No further work needed here.

## Referral credits — a separate path, not affected
Referral rewards do **not** use the manual top-up. They follow their own automatic flow:

```text
Member A refers B  ->  B buys a membership (min value set in settings)
  ->  B's bill is fully paid
  ->  system creates a reward for A (and B), % of the bill
  ->  reward is claimed into the wallet as a "referral" credit
```

Current setting for your branch: 10% to the referrer, 10% to the new member, as wallet credit, for memberships of value 24,000 or more.

So the referral flow cannot be "bypassed" by staff top-ups, and the top-up lock does not block referrals. Each reward can only be claimed once, only by that member or staff.

## Proposed next steps (only if you want them)
1. Check the referral flow end to end with a test referral (create, pay, see reward, claim to wallet), then cancel the test.
2. Confirm whether you want the automatic referral flow switched **on** or kept **off**, and whether rewards should land in the wallet automatically or wait for the member to claim.
3. Show referral credits clearly labelled "Referral reward" in the member's wallet history so they are never confused with manual top-ups.

## Technical details
- Manual top-ups: `wallet_adjust` RPC (credit: owner/admin/branch manager; debit: owner/admin/staff), atomic with `wallet_transactions`.
- Referrals: `convert_referral` -> `issue_referral_reward` (from payment settlement) -> `claim_referral_reward` (idempotent, writes `wallet_transactions` with `reference_type='referral_reward'`). Rates from `referral_settings` (`reward_mode=percentage`, values 10/10, `min_membership_value=24000`).
