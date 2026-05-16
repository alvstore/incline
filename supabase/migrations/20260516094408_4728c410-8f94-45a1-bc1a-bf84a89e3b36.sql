
-- System Health Audit RPCs

-- Top error fingerprints grouped (last N days)
CREATE OR REPLACE FUNCTION public.get_error_audit_top_fingerprints(_days int DEFAULT 7, _limit int DEFAULT 20)
RETURNS TABLE (
  fingerprint text,
  error_message text,
  source text,
  severity text,
  function_name text,
  route text,
  total_occurrences bigint,
  open_count bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(fingerprint, md5(error_message)) AS fingerprint,
    MAX(error_message) AS error_message,
    MAX(source) AS source,
    MAX(severity) AS severity,
    MAX(function_name) AS function_name,
    MAX(route) AS route,
    SUM(COALESCE(occurrence_count, 1))::bigint AS total_occurrences,
    SUM(CASE WHEN status = 'open' THEN COALESCE(occurrence_count, 1) ELSE 0 END)::bigint AS open_count,
    MIN(COALESCE(first_seen, created_at)) AS first_seen,
    MAX(COALESCE(last_seen, created_at)) AS last_seen
  FROM public.error_logs
  WHERE COALESCE(last_seen, created_at) >= now() - (_days || ' days')::interval
  GROUP BY COALESCE(fingerprint, md5(error_message))
  ORDER BY total_occurrences DESC
  LIMIT _limit;
$$;

-- Errors grouped by source & severity (last N days)
CREATE OR REPLACE FUNCTION public.get_error_audit_breakdown(_days int DEFAULT 7)
RETURNS TABLE (
  source text,
  severity text,
  total bigint,
  open_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(source, 'frontend') AS source,
    COALESCE(severity, 'error') AS severity,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::bigint AS open_count
  FROM public.error_logs
  WHERE COALESCE(last_seen, created_at) >= now() - (_days || ' days')::interval
  GROUP BY COALESCE(source, 'frontend'), COALESCE(severity, 'error')
  ORDER BY total DESC;
$$;

-- Daily trend (last N days)
CREATE OR REPLACE FUNCTION public.get_error_audit_daily_trend(_days int DEFAULT 14)
RETURNS TABLE (
  day date,
  total bigint,
  critical_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (COALESCE(last_seen, created_at))::date AS day,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN COALESCE(severity,'error')='critical' THEN 1 ELSE 0 END)::bigint AS critical_count
  FROM public.error_logs
  WHERE COALESCE(last_seen, created_at) >= now() - (_days || ' days')::interval
  GROUP BY (COALESCE(last_seen, created_at))::date
  ORDER BY day ASC;
$$;

-- Top noisy routes
CREATE OR REPLACE FUNCTION public.get_error_audit_top_routes(_days int DEFAULT 7, _limit int DEFAULT 10)
RETURNS TABLE (route text, total bigint, open_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(route,''), '—') AS route,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::bigint AS open_count
  FROM public.error_logs
  WHERE COALESCE(last_seen, created_at) >= now() - (_days || ' days')::interval
    AND COALESCE(source,'frontend') = 'frontend'
  GROUP BY COALESCE(NULLIF(route,''), '—')
  ORDER BY total DESC
  LIMIT _limit;
$$;

-- DB linter sweep: tables without RLS in public schema
CREATE OR REPLACE FUNCTION public.get_db_audit_rls_status()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)::bigint AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY c.relrowsecurity ASC, c.relname ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_error_audit_top_fingerprints(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_error_audit_breakdown(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_error_audit_daily_trend(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_error_audit_top_routes(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_db_audit_rls_status() TO authenticated;
