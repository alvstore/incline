
## Cluster-by-cluster audit

### C3 — `payment_method` column does not exist on `invoices`
- **Cause:** Both overloads of `public.assign_locker_with_billing` do `INSERT INTO invoices (..., payment_method, ...)`. That column was removed from `invoices` (payment method now lives on `payment_transactions`).
- **Fix:** Drop `payment_method` from the INSERT column list in both overloads of `assign_locker_with_billing` (migration).

### C4 — enum `locker_status: "occupied"`
- **Cause:** Older overload wrote `status = 'occupied'`. Both overloads now already use `'assigned'` in the current schema (the 15:42 error occurred before the previous fix landed).
- **Action:** No new code fix needed. Verified during migration.

### C5 — infinite recursion on policy for `members`
- **Cause:** `View members policy` calls `trainer_can_view_member(auth.uid(), id)` which is `SECURITY DEFINER` **but its owner is not a superuser**, so RLS still applies to its internal `SELECT ... FROM public.members`, re-entering the same policy → recursion.
- **Fix:** Rewrite the trainer branch to avoid touching `members` from inside a SECURITY DEFINER. In the policy, replace the trainer clause with a direct check that only touches `trainers` and `member_pt_packages` (neither has a recursive policy):
  ```sql
  OR (
    has_role(auth.uid(), 'trainer')
    AND (
      assigned_trainer_id IN (SELECT id FROM public.trainers WHERE user_id = auth.uid())
      OR id IN (
        SELECT mpp.member_id FROM public.member_pt_packages mpp
        JOIN public.trainers t ON t.id = mpp.trainer_id
        WHERE t.user_id = auth.uid() AND mpp.status = 'active'
      )
    )
  )
  ```
  Keep `trainer_can_view_member` for other callers but remove its use from the members SELECT policy.

### C1 + C2 — Storage 401 on `avatars/<member_user_id>/avatar-*.jpg` → frontend "Permission denied"
- **Shared cause:** Storage RLS on the public `avatars` bucket only allows `auth.uid()::text = foldername[1]` (owner-only writes). When an admin/staff uploads a member's photo via `MemberAvatarUpload`, the folder is the target member's `user_id`, not the admin's. Storage returns 401, and the frontend surfaces the generic "Permission denied" toast + logs to `error_logs` (that's Cluster 1).
- **Fix (single migration):** Add three storage policies on `avatars` allowing owner/admin/manager/staff to INSERT/UPDATE/DELETE objects under a member's user_id folder (path matches an existing `members.user_id` in a branch the caller can manage). Reuse `has_any_role` + `manages_branch` / `get_user_branch`. Keep the existing owner-only policies intact for members uploading their own photo.
  ```sql
  CREATE POLICY "Staff upload member avatar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND public.staff_can_write_avatar(auth.uid(), name));
  -- + UPDATE + DELETE variants; helper checks role + branch scope
  ```
  Add `staff_can_write_avatar(_user_id uuid, _path text)` SECURITY DEFINER helper that resolves `foldername[1]::uuid` to a member and confirms admin/owner OR manager/staff of that member's branch.

---

## Locker UX rework — flat fee for lifecycle period (not monthly)

Current drawer forces "monthly rental × months", which is wrong for our billing model. New model:

- **Label change:** "Charge Monthly Rental?" → **"Charge Rental Fee?"** with helper text "Charged once for the assignment period".
- **Fee input:** "Rental Fee (₹ per month)" → **"Rental Fee (₹)"** — single flat amount for the whole period.
- **Duration:** default toggle `Sync with Membership` to **ON** whenever the member has an active membership; hide the 1/3/6/12-month picker in that case. When no active membership, show a date range (start today, end date picker) instead of month buckets.
- **Total card:** show flat fee (no `× months` multiplication).
- **Backend:** call `assign_locker_with_billing` with `p_fee_amount = <flat>`, `p_billing_months = 1` so invoice line reads `Locker M-007 (01 Aug 2026 – 27 Jul 2027)` instead of "(12 months)". Update the invoice line label inside the RPC to use the date range when `p_billing_months = 1` and end_date > start_date + 40 days.

### Files to edit
- `supabase/migrations/<new>.sql` — Cluster fixes C3, C5, C1/C2 + updated `assign_locker_with_billing` (drop `payment_method`, new item label).
- `src/components/lockers/AssignLockerDrawer.tsx` — copy, single flat-fee input, default sync ON, remove `× months` math, pass `billing_months = 1` with total fee.
- `src/services/lockerService.ts` — no signature change needed (already forwards `fee_amount` / `billing_months`), but update the client-side invoice preview text.

### Out of scope
- No changes to lifecycle backfills, MIPS sync, or campaign pipeline.
- Keep the older `assign_locker_with_billing` overload for backward compatibility; only patch the SQL bugs.

### Verification
- Run `assign_locker_with_billing` from psql against a test locker/member — invoice inserts cleanly, status `assigned`.
- `/members` and `/profile` load without 500 recursion errors.
- Admin uploads a member avatar via `MemberAvatarUpload` — 200 from storage, avatar visible immediately.
- Locker drawer: with membership synced, no "months" wording anywhere; total = fee entered.
