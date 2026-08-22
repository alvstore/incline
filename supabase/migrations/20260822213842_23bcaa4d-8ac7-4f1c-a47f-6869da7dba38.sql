-- 1) Trainer-visible client visit rhythm (own clients only)
CREATE OR REPLACE FUNCTION public.get_trainer_client_visits(p_days integer DEFAULT 7)
RETURNS TABLE (
  member_id uuid,
  visit_date date,
  first_seen timestamptz,
  last_seen timestamptz,
  scan_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT id FROM public.trainers WHERE user_id = auth.uid() LIMIT 1
  ),
  my_members AS (
    SELECT m.id
    FROM public.members m, me
    WHERE m.assigned_trainer_id = me.id
    UNION
    SELECT p.member_id
    FROM public.member_pt_packages p, me
    WHERE p.trainer_id = me.id AND p.status = 'active'
  ),
  raw AS (
    SELECT a.member_id, a.check_in AS at
    FROM public.member_attendance a
    JOIN my_members mm ON mm.id = a.member_id
    WHERE a.check_in >= now() - make_interval(days => GREATEST(1, LEAST(p_days, 30)))
    UNION ALL
    SELECT l.member_id, COALESCE(l.captured_at, l.created_at) AS at
    FROM public.access_logs l
    JOIN my_members mm ON mm.id = l.member_id
    WHERE l.member_id IS NOT NULL
      AND l.device_sn <> 'CRM-SYSTEM'
      AND COALESCE(l.captured_at, l.created_at) >= now() - make_interval(days => GREATEST(1, LEAST(p_days, 30)))
  )
  SELECT
    raw.member_id,
    (raw.at AT TIME ZONE 'Asia/Kolkata')::date AS visit_date,
    min(raw.at) AS first_seen,
    max(raw.at) AS last_seen,
    count(*)::int AS scan_count
  FROM raw
  WHERE EXISTS (SELECT 1 FROM me)
  GROUP BY 1, 2
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_client_visits(integer) TO authenticated;

-- 2) Duty presence for the calling staff/trainer, reconciling turnstile + payroll rows
CREATE OR REPLACE FUNCTION public.get_my_duty_presence()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last record;
  v_scans int := 0;
BEGIN
  SELECT COALESCE(l.captured_at, l.created_at) AS at,
         COALESCE(l.payload->>'deviceName', l.device_sn) AS gate
    INTO v_last
  FROM public.access_logs l
  WHERE l.profile_id = auth.uid()
    AND l.device_sn <> 'CRM-SYSTEM'
    AND COALESCE(l.captured_at, l.created_at) >= now() - interval '18 hours'
  ORDER BY COALESCE(l.captured_at, l.created_at) DESC
  LIMIT 1;

  SELECT count(*) INTO v_scans
  FROM public.access_logs l
  WHERE l.profile_id = auth.uid()
    AND l.device_sn <> 'CRM-SYSTEM'
    AND COALESCE(l.captured_at, l.created_at) >= (now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata';

  RETURN jsonb_build_object(
    'last_seen_at', v_last.at,
    'gate', v_last.gate,
    'scans_today', v_scans
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_duty_presence() TO authenticated;

-- 3) Active fitness plan conflicts for a set of members
CREATE OR REPLACE FUNCTION public.get_active_fitness_plan_conflicts(
  p_member_ids uuid[],
  p_plan_type text
)
RETURNS TABLE (
  plan_id uuid,
  member_id uuid,
  member_name text,
  plan_name text,
  valid_from date,
  valid_until date,
  assigned_by text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fp.id,
    fp.member_id,
    COALESCE(mp.full_name, m.member_code) AS member_name,
    fp.plan_name,
    fp.valid_from,
    fp.valid_until,
    COALESCE(cp.full_name, 'System') AS assigned_by
  FROM public.member_fitness_plans fp
  JOIN public.members m ON m.id = fp.member_id
  LEFT JOIN public.profiles mp ON mp.id = m.user_id
  LEFT JOIN public.profiles cp ON cp.id = fp.created_by
  WHERE fp.member_id = ANY(p_member_ids)
    AND fp.plan_type = p_plan_type
    AND (fp.valid_until IS NULL OR fp.valid_until >= CURRENT_DATE)
    AND public.has_capability(auth.uid(), 'members.read')
  ORDER BY fp.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_fitness_plan_conflicts(uuid[], text) TO authenticated;

-- 4) Close (supersede) existing active plans instead of deleting them
CREATE OR REPLACE FUNCTION public.supersede_fitness_plans(p_plan_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'members.read') THEN
    RAISE EXCEPTION 'Not authorised to supersede fitness plans';
  END IF;

  UPDATE public.member_fitness_plans
     SET valid_until = CURRENT_DATE - 1,
         updated_at = now()
   WHERE id = ANY(p_plan_ids)
     AND (valid_until IS NULL OR valid_until >= CURRENT_DATE);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.supersede_fitness_plans(uuid[]) TO authenticated;