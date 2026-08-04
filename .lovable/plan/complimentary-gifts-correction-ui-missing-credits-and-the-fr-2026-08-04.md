# Complimentary gifts: correction UI, missing credits, and the free-days error

## What the audit found

### 1. Ayush — the wrong gift can't be removed
Ayush Shrimali (INC-26-0046) has two complimentary grants, both created 31 Jul: Sauna Therapy x1 and Ice Bath x1. The Ice Bath one is the accidental grant.

The Comp / Gift drawer can only **create** grants. There is no edit, no revoke, no delete anywhere in the app, and no server function for it — so once a gift is issued it is permanent.

### 2. Saloni — the gifts exist but nothing can see them
Saloni Kothari (INC-26-0045) does have all three grants recorded: Sauna x1, Ice Bath x1 (both 31 Jul) and Body Composition & Posture Scan x1 (today).

The problem is that the app keeps complimentary sessions in a different place from the credits everything else reads:

- Granting a gift writes **only** to the complimentary-gift ledger.
- The member portal (My Benefits, member dashboard), the add-on showcase and — critically — the **booking engine** all read the **benefit-credits ledger**.

Saloni has zero rows in the credits ledger, so her gifts are invisible to her and cannot be booked. The same is true for Ayush's sauna gift and every gift ever granted this way. Only the staff-side Benefit Tracking page and the member profile Benefits tab read the gift ledger directly, which is why the grants look fine from one screen and missing from every other.

### 3. `column "old_values" of relation "audit_logs" does not exist`
`grant_membership_free_days` writes its audit row using `old_values` / `new_values`. The real columns are `old_data` / `new_data`. The whole grant transaction rolls back, so complimentary **days** currently cannot be granted at all.

## Changes

### A. Fix the free-days error
Rewrite `grant_membership_free_days` to use `old_data` / `new_data`, and wrap the audit insert so an audit-schema problem can never roll back a legitimate grant (same pattern already used in `correct_invoice`).

### B. One ledger — gifts become real, bookable credits
Extend the grant function so every complimentary grant also creates a matching credit row in the benefit-credits ledger, linked back to the gift row. Expiry follows the gift's own expiry when set, otherwise the member's membership end date.

Backfill the existing gifts so Saloni's Sauna, Ice Bath and Body Scan and Ayush's Sauna appear immediately in the portal and become bookable, without creating duplicates for anyone who already has credits.

### C. Correct or revoke a gift (the missing UI)
New server action to amend a grant, owner/admin/manager only, with a mandatory reason:
- change the session count (up or down, never below what is already used),
- revoke the grant entirely,
- keeps the linked credit row in step, and refuses to revoke sessions that have already been consumed,
- writes an audit entry.

New UI in the **Comp / Gift** drawer: the existing "Active comps" list becomes actionable — each row gets Edit sessions and Revoke, with the reason captured in a right-side sheet and a confirm step for revoke. The same list is surfaced on the member profile Benefits tab and Benefit Tracking so a wrong gift can be corrected from wherever it is spotted. Staff (non-manager) see the actions routed through the approval queue, matching how granting already works.

### D. Apply it to Ayush
Once shipped, revoke Ayush's Ice Bath gift (0 sessions used, so it revokes cleanly) with the reason recorded.

## Technical notes
- Migration: fix `grant_membership_free_days` audit columns; extend `grant_member_comp` to mirror into `member_benefit_credits` (`credits_total`/`credits_remaining`, `expires_at` from comp expiry → membership `end_date` → +1 year fallback, `benefit_type` enum via `safeBenefitEnum` equivalent, `benefit_type_id` exact); new `amend_member_comp(p_comp_id, p_new_sessions, p_reason)` handling both edit and revoke (`p_new_sessions = 0`).
- One-off data backfill for the four existing gift rows lacking credits.
- Frontend: `src/components/members/CompGiftDrawer.tsx` (actionable comps list + amend sheet), `src/components/members/MemberProfileDrawer.tsx` and `src/pages/BenefitTracking.tsx` (same actions on their gift lists), plus an `ApprovalQueue` handler for the staff-initiated `comp_amend` request type.
- No change to the plan-benefit path; gifts stay a separate, auditable layer that simply now also lands in the credits ledger the rest of the app reads.
