# Fix: Record Usage only offers plan benefits, not gifts/credits

## What's happening

On Benefit Tracking, Ayush shows three benefit cards (Steam room, Body Composition, Sauna Therapy), but the Record Usage drawer only lists **Steam room**.

Two confirmed causes:

1. The page merges plan benefits with complimentary gifts into `combinedBalances` for the cards, but the drawer is handed the raw plan-only `balances` list. Gift-only benefits (Body Composition, Sauna Therapy) never reach the drawer.
2. Even if they were passed, the drawer filters to `isUnlimited || remaining > 0`. Gift-only rows carry their quantity in `compRemaining` (plan `remaining` is 0), so they'd still be hidden. The same blind spot exists in `validateBenefitUsage`, which rejects anything not present in the plan with "Benefit not included in plan".

A third gap: recording usage only inserts into `benefit_usage`. It never decrements `member_comps.used_sessions` or `member_benefit_credits.credits_remaining`, so a gift session could be recorded unlimited times.

## The fix

**Backend — one atomic RPC**

Add `record_benefit_usage(p_membership_id, p_member_id, p_benefit_type, p_benefit_type_id, p_usage_count, p_notes)`:
- Resolves entitlement in priority order: plan allowance remaining → active comp gifts → purchased credits.
- Rejects with a clear message when nothing is available.
- Inserts the `benefit_usage` row and decrements the consumed source (`member_comps.used_sessions` or `member_benefit_credits.credits_remaining`) in the same transaction.
- Returns which source was consumed and what remains, so the UI can show "1 gift session used, 0 left".
- `SECURITY DEFINER`, pinned `search_path`, staff/branch permission check, `GRANT EXECUTE` to `authenticated`.

**Frontend**

- `BenefitTracking.tsx`: pass `combinedBalances` (not `balances`) to the drawer.
- `RecordBenefitUsageDrawer.tsx`:
  - Show a benefit when `isUnlimited || remaining > 0 || compRemaining > 0`.
  - Label gift entries in the dropdown ("Sauna Therapy — 1 gift session").
  - Cap the usage-count input at plan remaining + gift/credit remaining.
  - Drop the separate client-side validate call; call the new RPC and surface its message on failure.
  - Show plan vs gift vs purchased breakdown in the summary box.
- `MemberProfileDrawer.tsx` already builds `[...planRows, ...giftOnlyRows]` — switch it to the same RPC path so both entry points behave identically.
- After success, run the existing `invalidateBenefitData` helper so cards, All Bookings and the member portal update live.

## Verification

- Record a Sauna Therapy gift session for Ayush: the entry appears in the dropdown, records, gift count drops 1 → 0, and the card refreshes without reload.
- Try recording it again: blocked with "No sessions remaining".
- Steam room (unlimited) still records with no limit.
