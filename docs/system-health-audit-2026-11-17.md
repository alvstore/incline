# Selected System Health audit — 17 November 2026

## Class update: confirmed
- **Evidence:** The reported class exists. The reporting account has owner/admin roles but no `staff_branches` or `branch_managers` entries. Live `Staff manage classes` policy required a branch assignment even for owners/admins; the SELECT policy already allowed them across branches. Effective table SELECT/UPDATE grants are present, so this was not a missing-GRANT failure.
- **Objects changed:** New migration `0188_restore_owner_admin_class_updates.sql` adds an UPDATE-only owner/admin policy with identical USING/WITH CHECK checks. Existing manager/trainer restrictions, inserts and deletes remain unchanged.
- **Files changed:** `src/services/classService.ts` uses `maybeSingle()` and refuses a missing result with actionable feedback. `src/components/classes/EditClassDrawer.tsx` shows that feedback instead of a generic error.
- **Verification:** Signed-in owner saved the reported class's existing name unchanged through `updateClass`; its ID/name returned successfully and the populated Classes screen was checked. No booking, price, schedule or assignment was changed. Live policy read confirms the new rule. The original fingerprint was marked resolved and read back as resolved.
- **Test caveat:** An empty PATCH is not a valid RLS reproduction: the API returns zero rows for an empty update regardless of the new policy. The actual verification used a non-empty unchanged-value update.

## Fitness assignment notification: confirmed cause, trainer retest pending
- **Evidence:** The reporting account has only the trainer role. `sendOneNotification` directly inserted into `notifications`; the live INSERT policy allows owner/admin/manager/staff, not trainers. Effective INSERT grants exist. The existing trusted dispatcher already accepts trainers, so widening the direct-write policy was unnecessary.
- **Files changed:** `src/services/fitnessService.ts` now sends in-app assignment alerts through `dispatchCommunication`, supplies member/branch/account context, handles failed/suppressed results and includes the saved assignment ID in the notification dedupe key.
- **Compatibility:** `supabase/functions/_shared/fitnessNotification.ts` and the deployed dispatcher preserve category `fitness_plan` and the existing `/my-workout` or `/my-diet` destination. Other events are unaffected; access-revocation checks and notification/push triggers remain unchanged.
- **Verification:** Three focused routing tests and four existing class booking tests pass. A live dispatcher test to the owner's own account returned `sent`; notification readback confirmed category and workout destination. Both populated pages were checked and automatic build output is clean.
- **Not verified:** An actual trainer-session assignment and its member readback were not exercised; no member plan was created or changed. This fingerprint stays open rather than claiming that owner-session delivery verifies trainer delivery. The explicit test alert went only to the owner's account.

## Workspace connection
Google Search Console was linked freshly in the current workspace. The new connection's live website list returned HTTP 200 and owner access to both the domain property and the HTTPS root property. No old workspace connection was reused, no property was created and no sitemap was resubmitted.