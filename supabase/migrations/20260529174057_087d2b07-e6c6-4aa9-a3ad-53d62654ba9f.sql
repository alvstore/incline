
-- 1. dr_get_replication_tables: topological order of public tables based on FK graph
CREATE OR REPLACE FUNCTION public.dr_get_replication_tables()
RETURNS TABLE(table_name text, depth int, has_id_pk boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only owners/admins/service_role can introspect.
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'owner'::app_role)
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'dr_get_replication_tables: not authorized';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  tables AS (
    SELECT c.oid AS relid, c.relname::text AS tname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      -- Exclude transient/queue/audit tables that don't need mirroring.
      AND c.relname NOT IN (
        'dr_probe', 'dr_drill_log',
        'webhook_ingress_log', 'webhook_processing_log', 'webhook_failures',
        'communication_retry_queue', 'whatsapp_send_queue', 'whatsapp_send_locks',
        'system_health_pings', 'error_logs',
        'discount_redemption_attempts', 'membership_action_attempts',
        'purchase_attempts',
        'biometric_sync_queue', 'mips_sync_attempts', 'mips_sync_failures',
        'email_send_log', 'email_send_state',
        'campaign_runs',
        'otp_verifications'
      )
  ),
  edges AS (
    -- Edge: child depends on parent (self-refs ignored to avoid infinite loop).
    SELECT DISTINCT t.relname::text AS child, rt.relname::text AS parent
    FROM pg_constraint cn
    JOIN pg_class t ON t.oid = cn.conrelid
    JOIN pg_class rt ON rt.oid = cn.confrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE cn.contype = 'f'
      AND n.nspname = 'public' AND rn.nspname = 'public'
      AND t.relname <> rt.relname
      AND t.relname  IN (SELECT tname FROM tables)
      AND rt.relname IN (SELECT tname FROM tables)
  ),
  -- Recursive depth: roots (no parents) get depth 0; children = max(parent_depth)+1.
  depths AS (
    SELECT t.tname, 0 AS depth
    FROM tables t
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.child = t.tname)
    UNION ALL
    SELECT e.child, d.depth + 1
    FROM edges e
    JOIN depths d ON d.tname = e.parent
  ),
  final_depths AS (
    SELECT tname, max(depth) AS depth FROM depths GROUP BY tname
  ),
  pk_info AS (
    SELECT t.tname,
           EXISTS (
             SELECT 1
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = t.tname
               AND i.indisprimary
               AND a.attname = 'id'
               AND i.indnatts = 1
           ) AS has_id_pk
    FROM tables t
  )
  SELECT fd.tname::text, COALESCE(fd.depth, 0)::int, COALESCE(pi.has_id_pk, false)
  FROM final_depths fd
  LEFT JOIN pk_info pi ON pi.tname = fd.tname
  ORDER BY COALESCE(fd.depth, 0), fd.tname;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dr_get_replication_tables() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.dr_get_replication_tables() FROM anon;

-- 2. dr_get_cron_manifest: returns array of pg_cron jobs the standby should recreate.
CREATE OR REPLACE FUNCTION public.dr_get_cron_manifest()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, cron
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'owner'::app_role) THEN
    RAISE EXCEPTION 'dr_get_cron_manifest: owner-only';
  END IF;

  BEGIN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'jobname',  jobname,
               'schedule', schedule,
               'command',  command,
               'active',   active
             ) ORDER BY jobname
           ), '[]'::jsonb)
    INTO result
    FROM cron.job;
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    result := '[]'::jsonb;
  END;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dr_get_cron_manifest() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.dr_get_cron_manifest() FROM anon;
