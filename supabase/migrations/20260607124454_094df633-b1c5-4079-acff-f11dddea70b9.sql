-- Lock down 42 internal SECURITY DEFINER functions:
-- revoke EXECUTE from PUBLIC/anon/authenticated, keep service_role.
DO $$
DECLARE
  fn text;
  fn_list text[] := ARRAY[
    -- trigger-fired
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
    -- code generators
    'assign_employee_code','assign_trainer_code',
    'generate_invoice_number','generate_member_code','generate_trainer_code',
    -- cron-only workers
    'auto_close_stale_attendance','auto_disable_hardware_access',
    'auto_expire_memberships','auto_freeze_membership'
  ];
  r record;
BEGIN
  FOREACH fn IN ARRAY fn_list LOOP
    FOR r IN
      SELECT oid::regprocedure AS sig
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
  END LOOP;
END $$;