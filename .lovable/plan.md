# Code-quality and database security audit, with a phased fix plan

## What was checked (live, read-only, 8 Oct 2026)

| Area | Result |
|---|---|
| Code quality check (whole app) | 0 errors, 38 warnings in 28 files |
| Database security checker | 325 warnings, in 3 types |
| Privileged database functions | 468 in total; 317 can be called by any signed-in user; 5 can be called by visitors who are not signed in |
| Privileged functions without a pinned search path | 0 (good) |
| Privileged functions with no visible permission check in their code | 139 (26 of these are called directly by the app) |
| Tables with row security turned off | 0 (checked in an earlier audit) |

A deliverable document, `/mnt/documents/Incline_Security_Lint_Audit.md`, will hold the full lists below (every function name, file and line) so each phase can be ticked off.

## Phase 1 — Critical: functions that change data or send messages with no permission check (highest risk)

Any signed-in member could call these today. Each gets either "internal/scheduled jobs only" (remove access for signed-in users) or an in-function check for the caller's role, branch or ownership.

**Background jobs only (remove signed-in access; scheduled jobs keep working):**
auto_close_stale_attendance, auto_expire_memberships, archive_approval_audit_log, check_critical_error_alerts, cleanup_old_notifications, daily_reconcile_member_access, detect_renewal_cases, expire_wallet_balances, generate_renewal_invoices, mark_no_show_bookings, purge_expired_otp_verifications, reap_stuck_communication_logs, reconcile_payments_daily, reverse_stale_pt_purchases, record_health_ping, dr_table_counts, try_whatsapp_send_lock, release_whatsapp_send_lock, claim_meta_ai_reply, upsert_meta_contact_profile, record_delivery_event, bump_dynamic_memory_hit, create_ai_lead, mark_do_not_contact, clear_do_not_contact, set_handoff (server-side use only), log_member_lifecycle_event, create_system_notification, notify_member, issue_referral_reward, advance_referral_lifecycle, generate_pt_commission, release_pt_commission_for_invoice, reverse_trainer_commission, void_trainer_commission, settle_payment_adopt_manual, upsert_reconciliation_finding, resolve_reconciliation_finding, consume_batch_stock, bill_locker_period, release_locker, onboard_member, create_contract_signature_request, audit_set_actor, plus all internal `_` helpers (_consume_benefit_for_booking, _release_benefit_for_booking, _release_class_benefit_usage, _notify_booking_event, _refresh_class_booked_count, _resolve_audit_target_name, _staff_roster_for_date).

**Called by the app, so they need an in-function check instead:**
- Staff of the branch only: convert_proforma_to_invoice, mark_class_attendance, member_check_in, member_check_out, member_force_check_in, evaluate_member_access_state, recheck_invoice_reconciliation, resolve_campaign_audience / _v2, get_inactive_members, get_upcoming_birthdays, staff_day_blocks, ensure_facility_slots, set_handoff.
- The caller's own data only: pending_advance_for_user, workout_schedule_offset_load, validate_member_checkin, validate_class_booking.
- Read-only lookups that are OK to keep open, but tightened to return nothing sensitive: check_trainer_slot_available, validate_coupon (coupon must belong to the caller's branch), match_common_plans, is_staff_offboarded (own account only), get_employer_profile (staff only).

## Phase 2 — High: data leaks through read functions

- resolve_email_by_phone: sign-in function only, never signed-in users (stops anyone looking up emails by phone).
- resolve_mips_person_alias, member_access_status, members_blocked_for_dues, members_restorable_after_dues, renewal_due_cases, renewal_cases_report, renewal_payment_evidence, renewal_mark_contacted, voice_retention_candidates, pt_commission_due_for_period, notification_recipients, whatsapp_recipient_eligibility, get_error_audit_* (4), get_db_audit_rls_status, get_ai_purpose, match_ai_knowledge: staff/owner and branch checks, or background jobs only.
- trainer_can_view_member, member_branch_id, get_member_id, get_user_branch, staff_primary_branch, member_matches_segment: answer only about the caller unless the caller is staff.
- The 5 open to visitors who are not signed in: confirm each returns only public data. get_public_branches, get_org_branding and online_convenience_pct are fine to stay public. get_howbody_scan_by_token needs a long, unguessable token that expires. complete_password_setup needs a single-use token check.

## Phase 3 — Medium: the remaining ~178 privileged functions callable by signed-in users

These already contain a permission check (role, branch or ownership). For each one:
1. Confirm the check covers every write path, rejects a spoofed member/staff ID, and checks branch for managers and staff.
2. Remove "callable by anyone" access, then give access back only to signed-in users and to background jobs, so new functions never default to public.
3. Add a database rule so that, by default, new functions are not callable by anyone until access is granted.

## Phase 4 — Database hygiene

- Move the 3 extensions installed in the public area into a separate area (done with a backup check first, because search features use them).
- Add `revoke ... from public` to a CI check, so any migration that creates a privileged function without explicit access fails.

## Phase 5 — Code-quality warnings (38, low risk, no security impact)

- react-hooks/exhaustive-deps (20): fix missing dependencies, or memoise them. Main files: MemberFilterBar, date-range-filter, AdjustMembershipDatesDrawer, AppliesToPicker, AuthContext, CampaignDetailDrawer, MyTasksWidget, CorrectInvoiceDrawer.
- react-refresh/only-export-components (7): move helper exports out of component files.
- Unused lint-disable comments (7): delete them (useRenewalCenter ×3, useVoiceOps, LiveAccessLog, LeadFilters, TodaySessionsPanel).
- prefer-const (2) and no-useless-escape (2): trivial fixes.

## Phase 6 — Verification after each phase

- Re-run the database security checker and the code-quality check; the counts must go down.
- Live tests as Mohit Gurjar (member) and as a test front-desk account: each closed function must return "forbidden". Normal flows must still work: check-in, booking, store checkout, Razorpay payment, payroll settlement, renewals.
- Check the background-job runs in Automation Brain to confirm the scheduled jobs still succeed.

## Technical details

- Revoke pattern: `REVOKE EXECUTE ON FUNCTION public.f(args) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` Cron and triggers run as the owner or service role, so they keep working.
- Guard pattern inside a function: `IF NOT (public.has_role(auth.uid(),'owner') OR public.manages_branch(auth.uid(), p_branch_id)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;`
- Edge-function callers already use the service role, so revoking signed-in access does not affect them. Before each revoke, search `.rpc('name')` in `src/` (26 such client calls are listed in Phase 1).
- Pure helper functions used inside row-security rules (has_role, has_any_role, has_capability, manages_branch, user_visible_branch_ids, can_access_*) must stay callable by signed-in users. They are on the safe list, documented as intended.
- Delivery: one migration per phase, each tested before the next. Phases 1 and 2 first (estimated 2 turns), then 3 (2–3 turns), then 4–5 (1 turn).
