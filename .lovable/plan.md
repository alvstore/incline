# Fix five audit items

## 1. Registration redirects to 404
**Confirmed cause:** `src/pages/PublicRegistration.tsx` line ~134 does `nav("/member")` — that route does not exist.

**Fix:** Redirect to `/member-dashboard` (member home). Same effect as `getHomePath(["member"])`.

## 2. Send welcome message on self-registration
`register-member` currently sends only the OTP. After successful `verify_and_register`, dispatch a `member_welcome` communication (WhatsApp → SMS → email fallback via `dispatch-communication`) with the member's name and login link.

Also add `member_welcome` to `src/lib/templates/systemEvents.ts` so it shows up in Templates Hub for admins to author.

## 3. Sidebar / dashboard logo not visible for members
**Confirmed cause:** `organization_settings` SELECT policy only allows roles `owner/admin/manager/staff` — members are blocked, so `useOrgBranding()` returns `null` and BrandLogo falls back to the Dumbbell icon.

**Fix migration:** Add a second SELECT policy that lets any authenticated user read `logo_url` + `name` only. Since RLS is row-level (not column-level), the safest route is to allow authenticated SELECT on the row (logo/name are already public branding — not sensitive). Existing admin-write policy stays intact.

## 4. Avatar not showing / not syncing to MIPS
**Confirmed:** `sync-to-mips` reads photo from `members.biometric_photo_url → profiles.avatar_url → leads.avatar_url`. But when a member's avatar is uploaded via profile edit, it lands only in `profiles.avatar_url` and there is no re-enqueue into `biometric_sync_queue`, so the hardware never picks up the change.

**Fix:**
- Add a database trigger on `profiles.avatar_url` update: for each `members` row where `user_id = NEW.id`, enqueue a `biometric_sync_queue` row (op = `upsert`) so the existing MIPS cron pushes the new face photo.
- Also mirror `profiles.avatar_url` → `members.biometric_photo_url` when the member has no explicit biometric photo yet, so device-side face templates use it.

## 5. PT purchase drawer needs discount + payment method
Current `PurchasePTDrawer` only picks package + trainer, then calls `purchase_pt_package` RPC at list price. Staff cannot apply a discount or record the payment method — everything shows as unpaid invoice afterward.

**Fix:**
- Add fields: `discount_type` (none / percent / fixed / coupon code), `discount_value`, `payment_method` (cash/card/upi/bank/pending), `amount_paid`.
- Coupon path calls existing `redeemCoupon()` (`src/services/couponService.ts`).
- After the existing `purchase_pt_package` RPC creates the invoice, if `amount_paid > 0`, call the atomic `record_payment` RPC (memory: "single source of truth for all transactions") against the returned invoice id.
- Show computed breakdown using the existing `computePtCheckout` helper for GST split.

## Files to change

```text
src/pages/PublicRegistration.tsx           # /member → /member-dashboard
src/lib/templates/systemEvents.ts          # add member_welcome event
supabase/functions/register-member/index.ts# dispatch member_welcome after register
supabase/migrations/<new>.sql              # organization_settings SELECT for authenticated
                                            # + profiles.avatar_url trigger → biometric_sync_queue
src/components/members/PurchasePTDrawer.tsx# discount + payment fields
src/services/ptService.ts                  # accept discount/payment, call record_payment
```

## Out of scope for this turn
- Item about `posture_type` column: verified no code queries that column; existing schema uses `n`. Nothing to fix here.
- Broader "audit all RPCs" — separate large task; ask if you want that as a follow-up.

Reply "go" to implement, or edit any point.
