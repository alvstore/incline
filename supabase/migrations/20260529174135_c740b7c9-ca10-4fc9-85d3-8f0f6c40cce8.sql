
CREATE OR REPLACE FUNCTION public.dr_get_replication_tables()
RETURNS TABLE(table_name text, depth int, has_id_pk boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'owner'::app_role)
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'dr_get_replication_tables: not authorized';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  base_tables AS (
    SELECT c.relname::text AS tname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
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
    SELECT DISTINCT t.relname::text AS child, rt.relname::text AS parent
    FROM pg_constraint cn
    JOIN pg_class t ON t.oid = cn.conrelid
    JOIN pg_class rt ON rt.oid = cn.confrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE cn.contype = 'f'
      AND n.nspname = 'public' AND rn.nspname = 'public'
      AND t.relname <> rt.relname
      AND t.relname  IN (SELECT tname FROM base_tables)
      AND rt.relname IN (SELECT tname FROM base_tables)
  ),
  walk(tname, lvl) AS (
    SELECT t.tname, 0
    FROM base_tables t
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.child = t.tname)
    UNION ALL
    SELECT e.child, w.lvl + 1
    FROM edges e
    JOIN walk w ON w.tname = e.parent
    WHERE w.lvl < 50
  ),
  final_depths AS (
    SELECT tname, max(lvl) AS lvl FROM walk GROUP BY tname
  ),
  pk_info AS (
    SELECT bt.tname,
           EXISTS (
             SELECT 1
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = bt.tname
               AND i.indisprimary
               AND a.attname = 'id'
               AND i.indnatts = 1
           ) AS has_id_pk
    FROM base_tables bt
  )
  SELECT bt.tname::text,
         COALESCE(fd.lvl, 0)::int,
         COALESCE(pi.has_id_pk, false)
  FROM base_tables bt
  LEFT JOIN final_depths fd ON fd.tname = bt.tname
  LEFT JOIN pk_info pi ON pi.tname = bt.tname
  ORDER BY COALESCE(fd.lvl, 0), bt.tname;
END;
$$;
