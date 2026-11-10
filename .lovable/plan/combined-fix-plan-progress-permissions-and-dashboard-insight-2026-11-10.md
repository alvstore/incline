# Combined fix plan: progress permissions and dashboard insight persistence

## Audit result

These are **not one shared failure**. Cluster 1 is a current policy/function permission mismatch. Clusters 2 and 3 concern the same dashboard persistence transition, but need different handling: valid server attribution versus stopping obsolete browser writes.

No application or database changes have been made during this audit.

## Cluster 1 — `/my-progress`: `_trainer_owns_member` permission denied

**Root cause — confirmed in the live database:** the `Trainer reads own clients runs` SELECT policy on `treadmill_workouts` calls `_trainer_owns_member(uuid, uuid)`, but `authenticated` cannot execute that function. Migration `0089_trainer_health_guidance.sql` intentionally made it service-only; migration `0135_treadmill_cardio.sql` subsequently used it directly in a user-facing policy. PostgreSQL does not guarantee that another permissive policy, such as the member's own-row policy, bypasses this failing function call.

**Files:** one new migration created through the migration tool under `drizzle/migrations/`; the tool supplies its exact numbered filename. Do not modify either historical migration or `src/pages/MyProgress.tsx`.

**Minimal safe fix:** introduce a caller-bound policy helper, for example `trainer_can_read_member_runs(p_member uuid)`, that:
- Uses `auth.uid()` internally, not a caller-supplied trainer/user ID.
- Checks the caller's trainer role and allowed branch before delegating to `_trainer_owns_member`.
- Is a stable, pinned-search-path function, with an explicit direct-entry guard.
- Grants EXECUTE to `authenticated` and `service_role`, not PUBLIC/anon.

Replace only the trainer SELECT policy's helper call with the new helper. Keep `_trainer_owns_member` service-only so its other internal use in `_can_view_member_health` remains unchanged. Preserve the member, manager, and owner/admin policies.

**Verification:** member reads their own workouts; assigned trainer reads that client's workouts; unrelated/cross-branch trainer reads none; anonymous access remains blocked. Exercise `/my-progress` in a real member session.

## Cluster 2 — `ai-dashboard-insights`: invalid `user_id` foreign key

**Root cause — strong evidence:** the live foreign key requires `user_id` to reference a real authentication account, and the column is required. `supabase/functions/ai-dashboard-insights/index.ts` still falls back to the all-zero `SYSTEM_USER` UUID for internal calls, which is not a real account. Its all-branches path selects an owner, but the single-branch internal path still passes `caller.userId ?? SYSTEM_USER`. This can fail even while scheduled all-branches generation succeeds.

The existing owner is valid, and saved insight rows at 01:37 and 07:00 IST confirm later successful persistence. Recent function logs were unavailable, so the exact invocation body behind the selected failure cannot be recovered.

**Files:** `supabase/functions/ai-dashboard-insights/index.ts`; a focused attribution test next to it.

**Minimal code fix:** remove `SYSTEM_USER`. Resolve the saved-row author once for every invocation:
- Signed-in call: use the authenticated caller ID.
- Internal call, single branch or all branches: resolve a real owner account and validate it exists using the server auth client.
- Missing/invalid system author: return a clear configuration error before AI generation; never attempt an insert with a fabricated ID.

Pass this resolved author to every `buildForBranch` call. Keep the foreign key, required column, service-only writes, and branch authorization intact. Deploy only `ai-dashboard-insights` after tests.

**Verification:** signed-in, internal single-branch, and internal all-branches paths save valid author IDs; missing-owner path fails explicitly without generating or inserting an insight.

## Cluster 3 — `/dashboard`: RLS rejects an insight write

**Root cause — most likely an older frontend still saving directly:** the selected friendly message is produced by `src/services/errorLogService.ts` specifically when the original response contains `new row violates row-level security`. This points to INSERT/UPDATE rejection, not merely missing SELECT permission.

Live checks show authenticated SELECT is already granted, the policy's helper functions are executable, and there are no INSERT/UPDATE policies. Current `AIInsightsWidget.tsx` only SELECTs saved rows and invokes the server function to generate them. Closing browser writes is intentional.

**Files:** inspect/publish `src/components/dashboard/AIInsightsWidget.tsx`; no code edit is currently necessary because the obsolete browser insert has already been removed. `src/services/errorLogService.ts` is evidence, not the cause, and does not need changing for this fix.

**Minimal fix:** publish the current frontend and reload the dashboard so the browser uses server-only persistence. Do **not** add client write grants or permissive write policies. If a fresh error remains, capture its request method and original database response before proposing another database change.

**Verification:** owner/admin and branch-manager dashboard refreshes read the saved insight successfully; generation invokes the function and produces no browser POST/PATCH to `ai_dashboard_insights`; unrelated roles/branches cannot read financial insights.

## One coordinated implementation

1. Apply the scoped progress-policy migration and permission regression checks.
2. Fix and test valid server author resolution, then deploy the insights function.
3. Publish the existing server-only dashboard frontend and verify reload/generation.
4. Check for fresh occurrences of only these three fingerprints; resolve the selected health entries only after verification.

Use the Supabase skill's live permission/RLS verification guidance. No broad grant restoration, RLS disabling, fabricated account, unrelated security cleanup, or historical migration rewrite is included.