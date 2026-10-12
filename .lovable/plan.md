# Fix plan: 6 System Health errors

The six errors have four separate causes. Clusters 4 and 5 have the same cause.

## 1. Webhook Activity: "permission denied" (Cluster 1)
- **Cause:** Signed-in users are not allowed to run `get_payment_webhook_payload`. The earlier security lockdown turned this off, and nobody turned it back on for staff. Expanding a webhook row in /integrations/webhooks fails.
- **Fix:** Add a migration that turns it back on for signed-in users. The function must also check the caller: only an owner or admin, or a manager for that webhook's branch, may open it. Then remove the `as any` cast from `WebhookActivityPanel.tsx`.

## 2. Sign-up: agreement document blocked by row security (Cluster 3)
- **Cause:** `register-member` uses one shared admin connection. Step 10 calls `signInWithPassword` on that connection, which switches it to the new member's login. The agreement document is saved in a background task that is still running at that point. That insert into `member_documents` then runs as the member, and row security blocks it. As a result, new members have no document vault entry, even though the PDF was uploaded.
- **Fix:** Sign the member in on a separate, temporary connection so the admin connection stays admin. Then re-add the missing document records for affected members: those with a stored agreement PDF but no `registration_form` document row.

## 3. Renewal Center: "Not authorized" (Clusters 4 + 5, same cause)
- **Cause:** A user without the `manage_renewals` permission opened /renewal-center. Both `renewal_center_queue` and `renewal_funnel` correctly refused. The page loads data without checking permission first, so each visit records 2 errors.
- **Fix:** In `useRenewalCenter.ts` and `FollowUpCenter.tsx`, only load data when `can.manageRenewals(roles)` is true. Show users without permission a clear "You don't have access to renewals" message instead. Also hide the Renewal Center menu link from them. The database checks stay as they are.

## 4. Voice renewal: "Call does not match renewal case" (Cluster 2)
- **Cause:** The voice call was placed, but its record differs from the renewal case. The member's branch is different, or the call has no provider ID yet. `renewal_link_voice_call` refuses to link it, which is correct, but the tick reports it as an error.
- **Fix:** First, check the real record from 11 Oct 10:30 to confirm which field differs. If the branch differs (member moved branches), link by member and record a branch-mismatch note. If the provider ID is missing, retry the link on the next tick. Either way, record this as a handled outcome in `renewal-engine-tick`, not as a warning.

## 5. Daily owner report: one email failed (Cluster 6)
- **Cause:** The email service was temporarily unavailable for one of 4 deliveries. The other 3 were sent. The whole run is still marked as an error.
- **Fix:** In `daily-ops-summary`, retry only the failed channel once after a short wait. A partial delivery after that retry is recorded as a warning, not an error. A rerun skips deliveries already sent.

## Checks
- Run the definer-guard check and the build.
- Run a test sign-up and confirm the document record is created.
- Open Webhook Activity as owner, and Renewal Center as staff, and confirm no errors are recorded.
- Resolve the 6 errors in System Health.
