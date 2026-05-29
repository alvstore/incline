DROP FUNCTION IF EXISTS public.dr_get_replication_tables();

CREATE OR REPLACE FUNCTION public.dr_get_replication_tables()
RETURNS TABLE(table_name text, depth int, has_id_pk boolean, pk_columns text)
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
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('dr_probe', 'dr_drill_log')
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
      AND t.relname  IN (SELECT bt.tname FROM base_tables bt)
      AND rt.relname IN (SELECT bt.tname FROM base_tables bt)
  ),
  walk(tname, lvl) AS (
    SELECT bt.tname, 0
    FROM base_tables bt
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.child = bt.tname)
    UNION ALL
    SELECT e.child, w.lvl + 1
    FROM edges e
    JOIN walk w ON w.tname = e.parent
    WHERE w.lvl < 50
  ),
  final_depths AS (
    SELECT w.tname, max(w.lvl) AS lvl FROM walk w GROUP BY w.tname
  ),
  pk_info AS (
    SELECT bt.tname,
           COALESCE(string_agg(a.attname::text, ',' ORDER BY array_position(i.indkey::int[], a.attnum::int)), '') AS pk_cols,
           bool_or(a.attname = 'id') FILTER (WHERE i.indisprimary) AS includes_id,
           count(a.attname) FILTER (WHERE i.indisprimary) AS pk_count
    FROM base_tables bt
    LEFT JOIN pg_class c ON c.relname = bt.tname
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
    LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    GROUP BY bt.tname
  )
  SELECT bt.tname::text,
         COALESCE(fd.lvl, 0)::int,
         COALESCE(pi.includes_id AND pi.pk_count = 1, false),
         COALESCE(pi.pk_cols, '')::text
  FROM base_tables bt
  LEFT JOIN final_depths fd ON fd.tname = bt.tname
  LEFT JOIN pk_info pi ON pi.tname = bt.tname
  ORDER BY COALESCE(fd.lvl, 0), bt.tname;
END;
$$;

REVOKE ALL ON FUNCTION public.dr_get_replication_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dr_get_replication_tables() TO authenticated, service_role;