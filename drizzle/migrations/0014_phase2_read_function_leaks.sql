-- ============================================================================
-- Phase 2: close data leaks through read functions
-- ============================================================================

-- A. Background-only read functions: callable by backend functions / cron only.
--    Every in-database caller is a SECURITY DEFINER function, so nested calls keep working.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'resolve_mips_person_alias','member_access_status','members_blocked_for_dues','members_restorable_after_dues',
        'renewal_due_cases','renewal_mark_contacted','renewal_cases_report','renewal_payment_evidence',
        'voice_retention_candidates','pt_commission_due_for_period','notification_recipients',
        'whatsapp_recipient_eligibility','match_ai_knowledge','get_ai_purpose','get_howbody_scan_by_token'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;

-- complete_password_setup is self-scoped (auth.uid()); never meaningful for visitors.
REVOKE ALL ON FUNCTION public.complete_password_setup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_password_setup() TO authenticated, service_role;

-- B. Raising helper usable inside SQL-language functions (CASE ... THEN public.forbid(...)::type).
CREATE OR REPLACE FUNCTION public.forbid(p_action text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'forbidden: %', p_action USING ERRCODE = '42501';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.forbid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forbid(text) TO authenticated, service_role;

-- Lookup helpers used by RLS policies: when a signed-in user calls them DIRECTLY,
-- they may only ask about themself unless they hold a staff role.
CREATE OR REPLACE FUNCTION public.get_member_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('get_member_id')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
      THEN public.forbid('get_member_id')::uuid
    ELSE (SELECT m.id FROM public.members m WHERE m.user_id = _user_id LIMIT 1)
  END
$function$;

CREATE OR REPLACE FUNCTION public.get_user_branch(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('get_user_branch')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
      THEN public.forbid('get_user_branch')::uuid
    ELSE (SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = _user_id LIMIT 1)
  END
$function$;

CREATE OR REPLACE FUNCTION public.staff_primary_branch(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('staff_primary_branch')
         AND p_user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
      THEN public.forbid('staff_primary_branch')::uuid
    ELSE COALESCE(
      (SELECT e.branch_id FROM public.employees e WHERE e.user_id = p_user_id AND e.branch_id IS NOT NULL LIMIT 1),
      (SELECT t.branch_id FROM public.trainers t WHERE t.user_id = p_user_id AND t.branch_id IS NOT NULL LIMIT 1),
      (SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = p_user_id LIMIT 1)
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.member_branch_id(_member_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('member_branch_id')
         AND NOT EXISTS (SELECT 1 FROM public.members mm WHERE mm.id = _member_id AND mm.user_id = auth.uid())
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
      THEN public.forbid('member_branch_id')::uuid
    ELSE (SELECT m.branch_id FROM public.members m WHERE m.id = _member_id)
  END
$function$;

CREATE OR REPLACE FUNCTION public.trainer_can_view_member(_user_id uuid, _member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('trainer_can_view_member')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
      THEN public.forbid('trainer_can_view_member')::boolean
    ELSE (
      EXISTS (
        SELECT 1 FROM public.members m
        JOIN public.trainers t ON t.id = m.assigned_trainer_id
        WHERE m.id = _member_id AND t.user_id = _user_id
      ) OR EXISTS (
        SELECT 1 FROM public.member_pt_packages mpp
        JOIN public.trainers t ON t.id = mpp.trainer_id
        WHERE mpp.member_id = _member_id
          AND t.user_id = _user_id
          AND mpp.status = 'active'::pt_package_status
      )
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.member_matches_segment(p_member_id uuid, p_status text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('member_matches_segment')
         AND NOT public.is_branch_staff((SELECT m.branch_id FROM public.members m WHERE m.id = p_member_id), false)
      THEN public.forbid('member_matches_segment')::boolean
    ELSE (
      CASE COALESCE(p_status, 'all')
        WHEN 'all' THEN true
        WHEN 'active' THEN EXISTS (
          SELECT 1 FROM public.memberships ms
          WHERE ms.member_id = p_member_id AND ms.status = 'active' AND ms.end_date >= CURRENT_DATE)
        WHEN 'expired' THEN EXISTS (
          SELECT 1 FROM public.memberships ms
          WHERE ms.member_id = p_member_id AND ms.end_date < CURRENT_DATE)
        WHEN 'recent_expired' THEN EXISTS (
          SELECT 1 FROM public.memberships ms
          WHERE ms.member_id = p_member_id
            AND ms.end_date < CURRENT_DATE
            AND ms.end_date >= CURRENT_DATE - 30)
          AND NOT EXISTS (
          SELECT 1 FROM public.memberships ms2
          WHERE ms2.member_id = p_member_id AND ms2.status = 'active' AND ms2.end_date >= CURRENT_DATE)
        WHEN 'frozen' THEN EXISTS (
          SELECT 1 FROM public.memberships ms
          WHERE ms.member_id = p_member_id AND ms.status = 'frozen')
        WHEN 'pending_dues' THEN EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.member_id = p_member_id
            AND COALESCE(i.status::text, '') NOT IN ('cancelled', 'voided', 'draft')
            AND COALESCE(i.total_amount, 0) - COALESCE(i.amount_paid, 0) > 0)
        WHEN 'inactive_30' THEN NOT EXISTS (
          SELECT 1 FROM public.member_attendance a
          WHERE a.member_id = p_member_id AND a.check_in >= now() - interval '30 days')
        WHEN 'inactive_60' THEN NOT EXISTS (
          SELECT 1 FROM public.member_attendance a
          WHERE a.member_id = p_member_id AND a.check_in >= now() - interval '60 days')
        ELSE true
      END
    )
  END
$function$;

-- C. System-audit reports: owner/admin only.
CREATE OR REPLACE FUNCTION public.get_db_audit_rls_status()
RETURNS TABLE(table_name text, rls_enabled boolean, policy_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF public.rpc_guard_applies('get_db_audit_rls_status')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: get_db_audit_rls_status' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)::bigint AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY c.relrowsecurity ASC, c.relname ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_error_audit_breakdown(_days integer DEFAULT 7)
RETURNS TABLE(source text, severity text, total bigint, open_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF public.rpc_guard_applies('get_error_audit_breakdown')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: get_error_audit_breakdown' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(el.source, 'frontend') AS source,
    COALESCE(el.severity, 'error') AS severity,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN el.status='open' THEN 1 ELSE 0 END)::bigint AS open_count
  FROM public.error_logs el
  WHERE COALESCE(el.last_seen, el.created_at) >= now() - (_days || ' days')::interval
  GROUP BY COALESCE(el.source, 'frontend'), COALESCE(el.severity, 'error')
  ORDER BY total DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_error_audit_daily_trend(_days integer DEFAULT 14)
RETURNS TABLE(day date, total bigint, critical_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF public.rpc_guard_applies('get_error_audit_daily_trend')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: get_error_audit_daily_trend' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (COALESCE(el.last_seen, el.created_at))::date AS day,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN COALESCE(el.severity,'error')='critical' THEN 1 ELSE 0 END)::bigint AS critical_count
  FROM public.error_logs el
  WHERE COALESCE(el.last_seen, el.created_at) >= now() - (_days || ' days')::interval
  GROUP BY (COALESCE(el.last_seen, el.created_at))::date
  ORDER BY 1 ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_error_audit_top_fingerprints(_days integer DEFAULT 7, _limit integer DEFAULT 20)
RETURNS TABLE(fingerprint text, error_message text, source text, severity text, function_name text, route text, total_occurrences bigint, open_count bigint, first_seen timestamp with time zone, last_seen timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF public.rpc_guard_applies('get_error_audit_top_fingerprints')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: get_error_audit_top_fingerprints' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(el.fingerprint, md5(el.error_message)) AS fingerprint,
    MAX(el.error_message) AS error_message,
    MAX(el.source) AS source,
    MAX(el.severity) AS severity,
    MAX(el.function_name) AS function_name,
    MAX(el.route) AS route,
    SUM(COALESCE(el.occurrence_count, 1))::bigint AS total_occurrences,
    SUM(CASE WHEN el.status = 'open' THEN COALESCE(el.occurrence_count, 1) ELSE 0 END)::bigint AS open_count,
    MIN(COALESCE(el.first_seen, el.created_at)) AS first_seen,
    MAX(COALESCE(el.last_seen, el.created_at)) AS last_seen
  FROM public.error_logs el
  WHERE COALESCE(el.last_seen, el.created_at) >= now() - (_days || ' days')::interval
  GROUP BY COALESCE(el.fingerprint, md5(el.error_message))
  ORDER BY 7 DESC
  LIMIT _limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_error_audit_top_routes(_days integer DEFAULT 7, _limit integer DEFAULT 10)
RETURNS TABLE(route text, total bigint, open_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF public.rpc_guard_applies('get_error_audit_top_routes')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: get_error_audit_top_routes' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(NULLIF(el.route,''), '—') AS route,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN el.status='open' THEN 1 ELSE 0 END)::bigint AS open_count
  FROM public.error_logs el
  WHERE COALESCE(el.last_seen, el.created_at) >= now() - (_days || ' days')::interval
    AND COALESCE(el.source,'frontend') = 'frontend'
  GROUP BY COALESCE(NULLIF(el.route,''), '—')
  ORDER BY 2 DESC
  LIMIT _limit;
END;
$function$;

-- Grants for the guarded helpers / reports: signed-in + service role, never anon.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'get_member_id','get_user_branch','staff_primary_branch','member_branch_id','trainer_can_view_member',
        'member_matches_segment','get_db_audit_rls_status','get_error_audit_breakdown','get_error_audit_daily_trend',
        'get_error_audit_top_fingerprints','get_error_audit_top_routes'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END
$do$;