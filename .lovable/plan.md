
## Diagnosis (from live DB)

**1. "Pending Plan" on paid members (opening day)**
- Server time is `2026-07-26` UTC, but IST it's already **27 Jul 2026 01:58 AM** — today's opening.
- 11 memberships have `status = 'pending'` with `start_date = 2026-07-27` and paid invoices. Sandeep Chouhan (INC-26-0014, `start_date=2026-12-01`) is legitimately future — will stay pending.
- Root cause: the `activate_scheduled_memberships` cron uses `current_date` (UTC). At `18:35 UTC` (00:05 IST 27 Jul), UTC is still 26 Jul, so `start_date=2026-07-27 <= current_date` is false and rows never flip.
- Fix: compare against IST (`(now() AT TIME ZONE 'Asia/Kolkata')::date`) and backfill immediately.

**2. Razorpay Payment Link paid but not reconciled**
- `payment_transactions` has one `plink_TI8pRvRNIcprMz` for ₹30,000 on invoice `333d6242…` stuck at `status='created'` with `gateway_payment_id=null`. Meaning Razorpay never delivered a webhook (URL not registered in Razorpay dashboard) or the webhook was rejected.
- `payment-webhook` edge fn exists but there's **no cron reconciler** for pending Razorpay payment links and **no manual "Verify now" button** in the invoice UI.

**3. Kaushay Jain (INC-26-0007) photo not visible to member**
- DB is correct: `members.biometric_photo_url` and `profiles.avatar_url` both point to the same public URL. The mirror trigger (profiles → members) works but there is **no reverse trigger** (members → profiles) for future uploads, and `AuthContext` fetches the profile only at login — no realtime subscription — so a member logged-in before the admin uploaded the photo keeps the stale (null) avatar until they hard-refresh.

---

## Plan

### Part A — Backfill (immediate)

1. **Activate all pending memberships whose `start_date <= today IST`** via `supabase--insert`:
   ```
   UPDATE public.memberships
      SET status = 'active', updated_at = now()
    WHERE status = 'pending'
      AND start_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND end_date  >= (now() AT TIME ZONE 'Asia/Kolkata')::date;
   ```
   Sandeep (start_date = 1 Dec 2026) stays pending — correct.

2. **Reconcile the stuck Razorpay payment** for invoice `333d6242…`:
   - Call `create-razorpay-link`'s companion Razorpay Payment-Link status API (via a new one-off edge call) to fetch the real state.
   - If paid: insert a `payments` row (₹30,000, method=razorpay, status=completed), update `payment_transactions` to `captured` with `gateway_payment_id`, mark invoice `paid`.

### Part B — Permanent fixes (migration + edge fn + UI)

3. **Timezone-aware activation cron** — migration:
   - Rewrite `activate_scheduled_memberships()` to use IST `current date`.
   - Re-schedule the cron to `05 19 * * *` UTC = **00:35 IST daily** (safety margin past midnight).
   - Add a second helper `expire_ended_memberships()` (same IST clock) so nothing else drifts.

4. **Razorpay auto-reconciliation** — new edge fn `reconcile-razorpay-links`:
   - Every 5 min, select `payment_transactions` rows where `gateway='razorpay'`, `status='created'`, `gateway_order_id LIKE 'plink_%'`, and `created_at > now() - interval '7 days'`.
   - Call `GET https://api.razorpay.com/v1/payment_links/{plink_id}` with existing `RAZORPAY_KEY_ID/SECRET`.
   - If `status='paid'`: reuse the same logic as `payment-webhook` (insert payment row, update invoice, mark tx `captured`).
   - Cron entry via `pg_cron` (system-call header).
   - Also add a **"Verify Razorpay payment" button** in `InvoiceViewDrawer` (visible to owner/admin/manager) that invokes the same fn for a single invoice on demand.

5. **Member photo live-refresh**:
   - Migration: add trigger `tg_mirror_member_photo_to_profile` on `members` — when `biometric_photo_url` changes, mirror to `profiles.avatar_url` for that `user_id` (defensive, complements existing reverse trigger).
   - `src/contexts/AuthContext.tsx`: add a Supabase Realtime subscription on `profiles` filtered by `id=eq.{user.id}` to update `profile.avatar_url` (and other whitelisted fields) live. Also call `refreshProfile()` on `visibilitychange → visible` so a returning tab re-hydrates without logout.
   - Cache-bust `<AvatarImage>` in `AppHeader.tsx` and `MemberProfile.tsx` by appending `?v={updated_at}` when the URL is present.

### Part C — Verification
- Re-query the 12 affected members; confirm 11 flip to `active`, Sandeep stays `pending`.
- Trigger `reconcile-razorpay-links` once manually; confirm the ₹30,000 invoice is settled and appears in Payments.
- Log in as Kaushay in an incognito tab; confirm avatar shows without cache clear.

---

## Files to be created / edited

**New**
- `supabase/migrations/20260727_ist_activation_photo_mirror.sql` — new `activate_scheduled_memberships()` (IST), reschedule cron, add `tg_mirror_member_photo_to_profile` trigger.
- `supabase/functions/reconcile-razorpay-links/index.ts` — poll + settle payment links.
- `supabase/functions/reconcile-razorpay-links/cron` entry (added inside the migration).

**Edited**
- `src/contexts/AuthContext.tsx` — realtime subscription on own `profiles` row + `visibilitychange` refetch.
- `src/components/layout/AppHeader.tsx`, `src/pages/MemberProfile.tsx` — cache-bust avatar URL.
- `src/components/invoices/InvoiceViewDrawer.tsx` — "Verify Razorpay payment" button (owner/admin/manager only, only when a `payment_transactions` row exists for the invoice with `status='created'`).