
-- Lock down anon EXECUTE on all public SECURITY DEFINER functions
-- except the small whitelist the public/unauthenticated UI actually needs.
-- Also strip authenticated from cron/edge-only functions.
DO $$
DECLARE
  r record;
  anon_whitelist text[] := ARRAY[
    'get_public_branches',
    'get_howbody_public_report'
  ];
  authed_strip text[] := ARRAY[
    'bump_ig_campaign_counters',
    'claim_meta_ai_reply',
    'upsert_meta_contact_profile',
    'record_delivery_event',
    'mark_no_show_bookings',
    'generate_renewal_invoices',
    'check_critical_error_alerts',
    'daily_reconcile_member_access',
    'reverse_stale_pt_purchases',
    'purge_expired_otp_verifications',
    'should_send_communication',
    'is_in_quiet_hours',
    'advance_referral_lifecycle',
    'award_group_bonus',
    'issue_referral_reward',
    'convert_referral',
    'evaluate_member_access_state',
    'get_employer_profile',
    'trg_payment_activate_pt_package',
    'fn_booking_status_audit'
  ];
  sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    sig := format('public.%I(%s)', r.proname, r.args);

    IF r.proname = ANY(anon_whitelist) THEN
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', sig);

    IF r.proname = ANY(authed_strip) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', sig);
    END IF;
  END LOOP;
END$$;
