
-- ============================================================
-- Security hardening: revoke unneeded EXECUTE grants and
-- document service-role-only intent on lock/token tables.
-- Read-only effect on application: trigger/system fns are
-- never callable via PostgREST in a meaningful way, and the
-- 3 tables already had RLS-on with zero policy (effectively
-- locked) — adding an explicit deny-by-default policy is
-- purely documentation.
-- ============================================================

-- 1. Trigger functions: never called directly by clients.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND (p.proname LIKE 'tg\_%' ESCAPE '\'
        OR p.proname IN ('update_updated_at_column','dr_block_writes','dr_readiness_touch_updated_at'))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END $$;

-- 2. DR / system-only RPCs: only service_role (or admin via dedicated wrappers) should call.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname IN (
        'dr_dump_schema',
        'dr_get_cron_manifest',
        'dr_get_replication_tables',
        'dr_is_operational',
        'dr_table_counts'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END $$;

-- 3. Explicit deny-by-default RLS policies for service-role-only tables.
-- These tables previously had RLS-on with zero policies (effectively locked
-- for all roles except service_role bypass). Make intent explicit.

-- whatsapp_send_locks
DROP POLICY IF EXISTS "Service role manages send locks" ON public.whatsapp_send_locks;
CREATE POLICY "Service role manages send locks" ON public.whatsapp_send_locks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- howbody_public_report_tokens
DROP POLICY IF EXISTS "Service role manages report tokens" ON public.howbody_public_report_tokens;
CREATE POLICY "Service role manages report tokens" ON public.howbody_public_report_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- meta_ai_reply_claims
DROP POLICY IF EXISTS "Service role manages ai reply claims" ON public.meta_ai_reply_claims;
CREATE POLICY "Service role manages ai reply claims" ON public.meta_ai_reply_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);
