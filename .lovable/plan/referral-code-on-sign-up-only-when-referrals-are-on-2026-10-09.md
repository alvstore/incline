# Referral code on sign-up (only when referrals are on)

## What happens today
- Members see "Your Referral Code" (their member code) and a share link that points to the **sign-in page** (`/auth?ref=CODE`).
- That sign-in page quietly remembers the code, but **nothing ever uses it**. New people join through `/register`, which has no referral box. So a shared code never links the new member to the person who referred them, and no reward can follow.
- The only way a referral is recorded today is staff adding it by hand on the Referrals page.

## What to build

### 1. Share link points to sign-up
Change the member's share link to `/register?ref=CODE` (the old `/auth?ref=` link forwards to `/register` with the code, so links already sent still work).

### 2. Referral box on /register — shown only when referrals are on
- When the branch's referral flow is **off** (as now): no box, no mention, any `?ref=` in the link is ignored.
- When **on**: an optional "Referral code" field with a **Validate** button on the details step. Pre-filled from the link if present.
- Validate asks the server; it answers only "valid — referred by Mohit G." (first name + initial) or "This code isn't valid". No other member details are revealed.
- Sign-up never fails because of a bad or empty code — the member can clear it and continue.

### 3. Server-side checks (the real security)
A visitor-callable check that:
- confirms the referral flow is on for that branch,
- finds an **active** member by code in the same branch,
- refuses self-referral (same phone/email as the person signing up),
- is rate-limited per phone/IP to stop code guessing.

At final sign-up the server **re-checks the code itself** (never trusts the browser's "valid" result), then saves the link: sets the new member's "referred by" and creates one referral record (status "joined"). One referral per new member only.

### 4. Rest of the flow unchanged
Rewards are still created only after a qualifying, fully paid membership, and the claim still goes to the branch manager for approval before money is added.

### 5. Accessibility
Labelled field, Validate button with clear name, result announced to screen readers, error linked to the field, not shown by colour alone (icon + text), keyboard usable, 44px touch target.

## Verification
- Referrals off: `/register` and `/register?ref=CODE` show no referral box.
- Temporarily on (test only, then back off): valid code shows the referrer's short name; wrong code, own code and inactive member are refused; guessing many codes gets blocked; finished sign-up shows the referral on the Referrals page as "joined". Test sign-up removed afterwards.

## Technical details
- New `validate_referral_code(p_code, p_branch_id, p_phone)` SECURITY DEFINER RPC, granted to anon + authenticated, guard comment for `check-definer-guards.ts`, rate limit via existing attempts-table pattern; returns `{valid, referrer_display}` only.
- New `get_referral_enabled(p_branch_id)` public read (boolean only) so `/register` knows whether to render the box.
- `register-member` edge fn: accept optional `referral_code`, re-validate server-side with the same rules, set `members.referred_by`, insert `referrals` (`lifecycle_status='joined'`, `referral_code`), unique per `referred_member_id`.
- `PublicRegistration.tsx`: read `?ref=`, conditional field (react-hook-form + zod, max 32 chars, uppercase/trim), not saved in the local draft once validated as invalid.
- `MemberReferrals.tsx` link → `/register?ref=`; `Auth.tsx` redirects `?ref=` to `/register?ref=`.
- Referral flow stays off; no setting changes.
