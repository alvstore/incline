# Resolve remaining linter findings safely

## Goal
Drop the SECURITY DEFINER linter count by revoking client-side `EXECUTE` on the **42 internal functions** that no UI / SDK code ever calls. This eliminates ~84 of the 388 secdef findings (0028 + 0029) with **zero functional risk** because every one of these 42 functions runs only via triggers, cron, or service-role workers — never via the Supabase JS client.

Total findings after this pass: **~342** (down from 426).

## What is in scope (safe to revoke)

42 functions across three buckets, all confirmed as never called from `src/`:

**Trigger functions (fired by `pg_trigger`, never via API):**
`tg_payment_activate_pt_package`, `trg_payment_status_reverse_commission`, `audit_log_trigger_function`, `audit_log_trigger_function_nb`, `audit_set_actor`, `auto_assign_member_role`, `auto_assign_staff_role`, `auto_assign_trainer_role`, `fn_comm_retry_queue_dedupe`, `fn_enqueue_failed_communication`, `fn_notify_lead_created`, `handle_new_feedback`, `handle_new_user`, `howbody_mirror_body_to_measurements`, `howbody_mirror_posture_to_measurements`, `howbody_notify_member_body`, `howbody_notify_member_posture`, `notifications_dedupe_guard`, `notify_late_attendance`, `notify_lead_created`, `notify_locker_assigned`, `notify_membership_expiring`, `notify_new_member`, `notify_payment_received`, `notify_referral_converted`, `sync_lead_to_contact`, `sync_member_to_contact`, `tasks_log_status_change`, `tasks_notify_assignee`, `update_slot_booked_count`, `update_updated_at`, `_notify_booking_event`, `_resolve_audit_target_name`

**Code-generators (called by triggers, not the client):**
`assign_employee_code`, `assign_trainer_code`, `generate_invoice_number`, `generate_member_code`, `generate_trainer_code`

**Cron-only workers (called by `pg_cron` as `service_role`):**
`auto_close_stale_attendance`, `auto_disable_hardware_access`, `auto_expire_memberships`, `auto_freeze_membership`

## What is explicitly NOT touched
- All `record_*`, `purchase_*`, `cancel_*`, `freeze_*`, `book_*`, `validate_*`, `redeem_*`, `signMemberDocument`, `has_role`, `has_capability`, `set_active_branch`, `transition_member_lifecycle`, `match_ai_knowledge`, `dispatchCommunication` paths — every legitimate UI RPC stays callable.
- The 13 accepted findings (3 extensions in public, 6 public buckets, 3 always-true RLS policies, 1 service-role-only table) stay as documented in the security memory.

## Migration

```sql
DO $$
DECLARE
  fn text;
  fn_list text[] := ARRAY[
    -- trigger functions
    'tg_payment_activate_pt_package','trg_payment_status_reverse_commission',
    'audit_log_trigger_function','audit_log_trigger_function_nb','audit_set_actor',
    'auto_assign_member_role','auto_assign_staff_role','auto_assign_trainer_role',
    'fn_comm_retry_queue_dedupe','fn_enqueue_failed_communication','fn_notify_lead_created',
    'handle_new_feedback','handle_new_user',
    'howbody_mirror_body_to_measurements','howbody_mirror_posture_to_measurements',
    'howbody_notify_member_body','howbody_notify_member_posture',
    'notifications_dedupe_guard','notify_late_attendance','notify_lead_created',
    'notify_locker_assigned','notify_membership_expiring','notify_new_member',
    'notify_payment_received','notify_referral_converted',
    'sync_lead_to_contact','sync_member_to_contact',
    'tasks_log_status_change','tasks_notify_assignee',
    'update_slot_booked_count','update_updated_at',
    '_notify_booking_event','_resolve_audit_target_name',
    -- code generators (trigger-fired)
    'assign_employee_code','assign_trainer_code',
    'generate_invoice_number','generate_member_code','generate_trainer_code',
    -- cron-only workers
    'auto_close_stale_attendance','auto_disable_hardware_access',
    'auto_expire_memberships','auto_freeze_membership'
  ];
BEGIN
  FOREACH fn IN ARRAY fn_list LOOP
    -- Revoke from public client roles for every overload of the function.
    EXECUTE format(
      'DO $i$ DECLARE r record; BEGIN
         FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc
                  WHERE pronamespace = ''public''::regnamespace AND proname = %L LOOP
           EXECUTE ''REVOKE EXECUTE ON FUNCTION '' || r.sig || '' FROM PUBLIC, anon, authenticated'';
           EXECUTE ''GRANT  EXECUTE ON FUNCTION '' || r.sig || '' TO service_role'';
         END LOOP;
       END $i$;',
      fn
    );
  END LOOP;
END $$;
```

## Validation
1. After migration runs, re-run `supabase--linter`. Expected: ~342 total findings (down from 426).
2. Smoke-check the live app:
   - Create a member → triggers `handle_new_user`, `assign_employee_code`, `auto_assign_member_role`, `sync_member_to_contact`, `notify_new_member` (all still fire because triggers run as table owner, not client).
   - Record a payment → triggers `tg_payment_activate_pt_package`, `notify_payment_received`, `audit_log_trigger_function`.
   - Wait for next `automation-brain-tick` (5 min) → cron workers still fire because cron runs as `service_role`.
3. Watch `error_logs` for `permission denied for function` over the next 15 minutes; rollback the affected function's grant if anything surfaces.

## Out of scope (next pass, your call)
- Triaging the remaining ~150 anon-callable RPCs (member portal, public landing, lead capture). Needs per-function review since some legitimately need `anon` for `/register`, public catalog, feedback flow, etc.
- The 4 cron worker names you may want kept anon-revoked but still allow manual "Run Now" buttons in `AutomationsControlRoom` — those buttons already go through edge functions with service-role, so this is safe.
