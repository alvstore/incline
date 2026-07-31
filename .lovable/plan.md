## What I verified

- Member **Love kumar paliwal (INC-26-0004)** has `user_id = null` in the database. His lead record does hold full PII (name, `lovekumarpaliwal77737777@gmail.com`, `+919001808487`), so there is enough data to mint a login.
- He is the **only** member out of 53 with no login — every other member came in through self-registration, which creates the account.
- Photo upload fails by design: the `avatars` bucket policy keys the file path on `auth.uid()`, so with no linked user there is nowhere valid to write. The drawer already tries to auto-provision by calling the `provision-member-login` edge function, then shows the "no login yet" toast you saw when that call returns nothing.
- The `provision-member-login` function exists in the codebase but has **zero invocation logs**, which strongly suggests it was never actually deployed (it also has no entry in the function config). This is the most likely reason the inline auto-provision silently does nothing. First step is to deploy it and confirm with a live call.
- `/admin-roles` today lists only people who already have a profile (i.e. already have a login). There is no surface anywhere in the app to create a login for an existing member — that is the missing UI you described.

## Plan

### 1. Make provisioning actually work
- Deploy `provision-member-login` and verify with a real invocation for INC-26-0004.
- Harden it: resolve PII from the linked lead, fall back to any existing profile match, look up existing auth users by email across all pages (current code only scans the first 200), return explicit error codes (`no_lead_pii_available`, `no_email_or_phone`, `email_taken_by_other_user`) instead of failing quietly.
- Keep it idempotent: re-running links the existing user rather than erroring, and always upserts the profile, the `member` role, and `members.user_id`.

### 2. New "Logins" surface in Admin Roles
Add a tab **"Members without login"** to `/admin-roles` (owner/admin only, matching the existing gate):
- Table: member name, member code, branch, email, phone, source (lead-converted vs walk-in), joined date.
- Row action **Create login** → calls the provisioning function, shows a clear success/failure toast, refreshes the list and the user-roles table.
- Inline editing of email/phone before creating, for members whose lead data is incomplete.
- Bulk **Create logins for all** action with per-row result summary.
- Empty state when every member has a login; skeleton loading; counts shown as a summary card alongside the existing role cards.

### 3. Create login from the member profile
- Add a **Create login** quick action in the member profile drawer, visible only when the member has no `user_id`. Same function call, same feedback.
- Update the avatar upload path so a failed provisioning attempt surfaces the real reason (e.g. "no email on file") instead of the generic message, and links the user to the create-login action.

### 4. Welcome communication (optional toggle)
When a login is created, offer a checkbox "Send welcome message with login link" that routes through the existing communication dispatcher (email/WhatsApp per configuration). Off by default for backfills, on by default for fresh conversions.

### 5. Backfill and verify
- Create the login for INC-26-0004, confirm `members.user_id` is populated, upload a photo end-to-end, and confirm the avatar renders in the member list and profile.
- Re-run the "members without login" query to confirm it returns zero rows.

## Technical notes

- Files touched: `supabase/functions/provision-member-login/index.ts`, `src/pages/AdminRoles.tsx`, a new `src/components/members/CreateMemberLoginDrawer.tsx` (side drawer per the no-dialog rule), `src/components/members/MemberProfileDrawer.tsx`, `src/components/members/MemberAvatarUpload.tsx`.
- The "members without login" list is a TanStack Query against `members` joined to `leads` for PII, filtered by `user_id is null` and scoped to the active branch context.
- No schema migration is required — `members.user_id`, `profiles`, and `user_roles` already model everything needed.
- Role assignment continues to go through the existing `assign_user_role` path so the audit trail stays intact.
