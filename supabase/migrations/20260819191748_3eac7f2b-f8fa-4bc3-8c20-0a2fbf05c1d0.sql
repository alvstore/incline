ALTER FUNCTION public.force_mips_reconcile(uuid) SET search_path = public;

DO $$
DECLARE
  fn record;
  public_allowlist text[] := ARRAY[
    'get_public_branches',
    'get_org_branding',
    'get_howbody_scan_by_token',
    'dr_is_operational'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.prorettype
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    IF NOT (fn.proname = ANY(public_allowlist)) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
      IF fn.prorettype = 'trigger'::regtype THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
      ELSE
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
      END IF;
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  fn record;
  system_only text[] := ARRAY[
    'activate_scheduled_memberships',
    'auto_close_stale_staff_attendance',
    'auto_resolve_brain_heartbeat',
    'expire_pt_packages',
    'claim_broadcast_batch',
    'reap_stuck_sending_campaigns',
    'prune_off_schedule_slots',
    'get_payment_webhook_payload',
    'force_mips_reconcile'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(system_only)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;