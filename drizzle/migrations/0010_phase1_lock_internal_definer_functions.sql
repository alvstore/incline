DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (string_to_array('auto_close_stale_attendance auto_expire_memberships archive_approval_audit_log check_critical_error_alerts cleanup_old_notifications daily_reconcile_member_access detect_renewal_cases expire_wallet_balances generate_renewal_invoices mark_no_show_bookings purge_expired_otp_verifications reap_stuck_communication_logs reconcile_payments_daily reverse_stale_pt_purchases record_health_ping dr_table_counts try_whatsapp_send_lock release_whatsapp_send_lock claim_meta_ai_reply upsert_meta_contact_profile record_delivery_event bump_dynamic_memory_hit create_ai_lead mark_do_not_contact clear_do_not_contact log_member_lifecycle_event create_system_notification notify_member issue_referral_reward advance_referral_lifecycle generate_pt_commission release_pt_commission_for_invoice reverse_trainer_commission void_trainer_commission settle_payment_adopt_manual upsert_reconciliation_finding resolve_reconciliation_finding consume_batch_stock bill_locker_period release_locker onboard_member create_contract_signature_request audit_set_actor _consume_benefit_for_booking _release_benefit_for_booking _release_class_benefit_usage _notify_booking_event _refresh_class_booked_count _resolve_audit_target_name _staff_roster_for_date resolve_email_by_phone', ' '))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;