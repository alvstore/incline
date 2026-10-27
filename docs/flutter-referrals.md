# Flutter — Referrals (same pattern as web)

Tracking is always on per branch (`referral_settings.tracking_enabled`, default true).
Reward payouts are a separate switch (`referral_settings.is_active`). The app must never
create rewards or wallet credit itself — the server does it.

## 1. Member's share link (Refer & Earn screen)
- Code = the member's `member_code` (e.g. `INC-26-0015`).
- Link = `https://theincline.in/register?ref=<url-encoded code>`.
- Buttons: Copy link, Share (WhatsApp intent with message + link). 44px targets, labelled.

## 2. Deep link into sign-up
- Register `theincline.in/register` as an App Link / Universal Link.
- Read `ref` from the URI, uppercase + trim, max 32 chars, keep in memory for the sign-up flow.

## 3. Sign-up screen referral field
1. Call RPC `get_referral_enabled(p_branch_id)` → boolean. Hide the field when false.
2. Optional "Referral code" field, prefilled from the link, with a **Validate** button.
3. On Validate call RPC `validate_referral_code(p_code, p_branch_id, p_phone, p_email)`.
   Response: `{ valid: true, referrer_display: "Mohit G." }` or `{ valid: false, reason: "invalid" | "rate_limited" | "disabled" }`.
4. Show result as icon + text (not colour only) and announce it (Semantics liveRegion).
5. Sign-up must never be blocked by a bad/empty code.

## 4. Final registration
Send `referral_code` in the body of the existing `register-member` function call. The server
re-checks the code (never trust the client result), sets `members.referred_by`, and creates one
`referrals` row (`lifecycle_status = 'joined'`).

## 5. Rewards (member side)
- List: `referrals` where `referrer_member_id = me`; `referral_rewards` where `member_id = me`.
- Call RPC `get_referral_rewards_enabled(p_branch_id)`. When false, show "Rewards paused" and hide Claim.
- Claim → RPC `request_referral_reward_claim(p_reward_id)`. It only creates a manager approval;
  wallet credit appears after approval. Show "Awaiting approval" when `claim_status = 'pending_approval'`.

## Don'ts
- No direct inserts into `referrals`, `referral_rewards`, or wallet tables.
- No reward amounts calculated in the app.
