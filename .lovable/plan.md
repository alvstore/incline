## Goal
Reduce the remaining 342 Supabase linter findings concentrated in rules `0028_anon_security_definer_function_executable` and `0029_authenticated_security_definer_function_executable` — without touching any application behavior.

## Findings Today
- 146 `SECURITY DEFINER` public functions are still executable by `anon`.
- The same set (plus ~20 more) is executable by `authenticated`.
- Audit of all client and edge-function callers shows the actual pre-auth (anon) surface is only **2 RPCs**:
  - `get_public_branches` — used by `/register`
  - `get_howbody_public_report` — used by `/howbody/report/:id`
- Everything else is called either from an authenticated session in the SPA, or from an edge function using the `service_role` admin client (which is unaffected by anon/authenticated grants).

## Strategy (Two-Pass, Single Migration)

### Pass A — Revoke `anon` EXECUTE from 144 functions
Drop `anon` from every SECURITY DEFINER public function **except** the 2-RPC public whitelist. Examples of the bulk being trimmed:
- Member-portal RPCs (book_class, book_facility_slot, member_check_in, record_member_measurement, claim_referral_reward, …)
- Staff/admin RPCs (purchase_membership, record_payment, freeze_membership, cancel_membership, payroll_*, process_approval_request, decide_role_change_request, …)
- Search/analytics helpers (search_command_*, analytics_revenue_*, get_inactive_members, …)
- Permission/identity helpers (has_role, has_capability, user_visible_branches, current_active_branch, …)

None of these are called from unauthenticated client code or from any anon-key flow — verified via repo-wide grep of `supabase.rpc(...)` plus all edge function callers.

### Pass B — Also revoke `authenticated` EXECUTE on cron/edge-only functions
A subset is called exclusively from edge functions (which use service_role) or from pg_cron. Removing `authenticated` here is safe and drops a matching `0029` finding too:
- `bump_ig_campaign_counters`, `claim_meta_ai_reply`, `upsert_meta_contact_profile`, `record_delivery_event`, `mark_no_show_bookings`, `generate_renewal_invoices`, `check_critical_error_alerts`, `daily_reconcile_member_access`, `reverse_stale_pt_purchases`, `purge_expired_otp_verifications`, `should_send_communication`, `is_in_quiet_hours`, `advance_referral_lifecycle`, `award_group_bonus`, `issue_referral_reward`, `convert_referral`, `evaluate_member_access_state`, `get_employer_profile`, `trg_payment_activate_pt_package`, `fn_booking_status_audit`.

`service_role` keeps `EXECUTE` (re-granted explicitly) on every touched function so edge functions and triggers continue to run.

### Untouched (still anon-executable on purpose)
- `get_public_branches`
- `get_howbody_public_report`

## Expected Linter Impact
- ~144 `0028_anon_*` findings cleared (Pass A).
- ~20 additional `0029_authenticated_*` findings cleared (Pass B).
- Projected total: **342 → ~178** (≈48% drop).

## Validation Plan
1. Migration runs as one transaction — if any function name typo, the whole revoke rolls back.
2. After apply, smoke check in preview:
   - Member portal: load `/portal`, book a class slot, view dues.
   - Staff: open Members list (uses `search_members`), record a payment, freeze/cancel a membership.
   - Public: `/register` lists branches; `/howbody/report/:id` loads.
3. Tail `error_logs` for 15 min looking for `permission denied for function`. If any appears, the offending function gets a follow-up `GRANT EXECUTE ... TO authenticated` (one-line hotfix).
4. Re-run `supabase--linter`; expect ≤180 findings.

## Out of Scope (Future Passes)
- The remaining ~178 findings cover legitimately authenticated user RPCs. Removing `authenticated` from those WOULD break the app, so they require redesign (move to edge function + service_role) and are deferred.
- `0025_public_bucket_allows_listing` (6), `0024_permissive_rls_policy` (3), `0014_extension_in_public` (3), `0008_rls_enabled_no_policy` (1) — separate tickets, different fix patterns.

## Risk
Low. Worst case is a single missed authenticated caller throws "permission denied for function X"; the fix is a one-line `GRANT EXECUTE ... TO authenticated;` follow-up migration. No data is modified; no behavior changes for any role that legitimately needs access.

Approve to switch to build mode and apply the migration.
