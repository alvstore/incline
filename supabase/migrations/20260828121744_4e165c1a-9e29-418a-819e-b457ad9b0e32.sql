CREATE OR REPLACE FUNCTION public.get_upcoming_birthdays(p_days_ahead integer DEFAULT 7, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(today jsonb, upcoming jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  RETURN QUERY
  WITH people AS (
    SELECT m.id AS person_id, m.user_id, m.member_code AS person_code, 'member'::text AS person_type, m.branch_id
    FROM public.members m
    WHERE m.status = 'active'
    UNION ALL
    SELECT t.id, t.user_id, t.trainer_code, 'trainer'::text, t.branch_id
    FROM public.trainers t
    WHERE t.is_active IS TRUE AND t.user_id IS NOT NULL
    UNION ALL
    SELECT e.id, e.user_id, e.employee_code, 'staff'::text, e.branch_id
    FROM public.employees e
    WHERE e.is_active IS TRUE AND e.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.trainers t2 WHERE t2.user_id = e.user_id AND t2.is_active IS TRUE)
  ),
  base AS (
    SELECT DISTINCT ON (pe.user_id, pe.person_type)
      pe.person_id    AS member_id,
      pe.user_id      AS user_id,
      pe.person_code  AS member_code,
      pe.person_type  AS person_type,
      p.full_name     AS full_name,
      p.avatar_url    AS avatar_url,
      p.date_of_birth AS dob,
      CASE
        WHEN to_char(p.date_of_birth, 'MMDD') >= to_char(v_today, 'MMDD')
          THEN make_date(
                 extract(year FROM v_today)::int,
                 extract(month FROM p.date_of_birth)::int,
                 LEAST(
                   extract(day FROM p.date_of_birth)::int,
                   extract(day FROM (make_date(extract(year FROM v_today)::int,
                                               extract(month FROM p.date_of_birth)::int, 1)
                                     + interval '1 month' - interval '1 day'))::int
                 ))
        ELSE make_date(
                 extract(year FROM v_today)::int + 1,
                 extract(month FROM p.date_of_birth)::int,
                 LEAST(
                   extract(day FROM p.date_of_birth)::int,
                   extract(day FROM (make_date(extract(year FROM v_today)::int + 1,
                                               extract(month FROM p.date_of_birth)::int, 1)
                                     + interval '1 month' - interval '1 day'))::int
                 ))
      END AS birthday_date
    FROM people pe
    JOIN public.profiles p ON p.id = pe.user_id
    WHERE p.date_of_birth IS NOT NULL
      AND (p_branch_id IS NULL OR pe.branch_id = p_branch_id OR pe.branch_id IS NULL)
  ),
  enriched AS (
    SELECT
      member_id, user_id, member_code, person_type, full_name, avatar_url, dob, birthday_date,
      (birthday_date - v_today) AS days_until,
      (extract(year FROM birthday_date) - extract(year FROM dob))::int AS turning_age
    FROM base
    WHERE birthday_date <= v_today + (p_days_ahead || ' days')::interval
  ),
  today_rows AS (
    SELECT jsonb_agg(to_jsonb(e.*) ORDER BY full_name) AS data
    FROM enriched e WHERE days_until = 0
  ),
  upcoming_rows AS (
    SELECT jsonb_agg(to_jsonb(e.*) ORDER BY birthday_date, full_name) AS data
    FROM enriched e WHERE days_until > 0
  )
  SELECT
    COALESCE((SELECT data FROM today_rows), '[]'::jsonb),
    COALESCE((SELECT data FROM upcoming_rows), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_members_page(
  p_branch_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_plan_id uuid DEFAULT NULL,
  p_joined_from date DEFAULT NULL,
  p_joined_to date DEFAULT NULL,
  p_sort text DEFAULT 'joined',
  p_dir text DEFAULT 'desc',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  member_code text,
  user_id uuid,
  lead_id uuid,
  branch_id uuid,
  branch_name text,
  assigned_trainer_id uuid,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  derived_status text,
  membership_id uuid,
  plan_id uuid,
  plan_name text,
  start_date date,
  end_date date,
  days_left integer,
  dues numeric,
  joined_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
base AS (
  SELECT
    m.id, m.member_code, m.user_id, m.lead_id, m.branch_id, m.assigned_trainer_id,
    m.lifecycle_state, m.created_at,
    b.name AS branch_name,
    COALESCE(p.full_name, l.full_name) AS full_name,
    COALESCE(p.email, l.email)         AS email,
    COALESCE(p.phone, l.phone)         AS phone,
    COALESCE(p.avatar_url, l.avatar_url) AS avatar_url,
    act.id AS act_id, act.plan_id AS act_plan, act.start_date AS act_start, act.end_date AS act_end,
    act.status AS act_status,
    sch.id AS sch_id, sch.plan_id AS sch_plan, sch.start_date AS sch_start, sch.end_date AS sch_end,
    frz.id AS frz_id, frz.plan_id AS frz_plan, frz.start_date AS frz_start, frz.end_date AS frz_end,
    COALESCE(d.total_due, 0) AS dues
  FROM public.members m
  CROSS JOIN today t
  LEFT JOIN public.branches b ON b.id = m.branch_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN LATERAL (
    SELECT ms.* FROM public.memberships ms
    WHERE ms.member_id = m.id AND ms.status = 'active' AND ms.end_date >= t.d
    ORDER BY ms.end_date DESC LIMIT 1
  ) act ON TRUE
  LEFT JOIN LATERAL (
    SELECT ms.* FROM public.memberships ms
    WHERE ms.member_id = m.id AND ms.start_date > t.d
      AND ms.status NOT IN ('cancelled','expired','transferred')
    ORDER BY ms.start_date ASC LIMIT 1
  ) sch ON TRUE
  LEFT JOIN LATERAL (
    SELECT ms.* FROM public.memberships ms
    WHERE ms.member_id = m.id AND ms.status = 'frozen'
    ORDER BY ms.end_date DESC LIMIT 1
  ) frz ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(GREATEST(COALESCE(i.total_amount,0) - COALESCE(i.amount_paid,0), 0)) AS total_due
    FROM public.invoices i
    WHERE i.member_id = m.id AND i.status IN ('pending','partial','overdue')
  ) d ON TRUE
  WHERE (p_branch_id IS NULL OR m.branch_id = p_branch_id)
),
shaped AS (
  SELECT
    b.*,
    (SELECT d FROM today) AS today_d,
    CASE
      WHEN b.act_id IS NOT NULL THEN 'active'
      WHEN b.lifecycle_state = 'pending_plan' THEN 'pending_plan'
      WHEN b.sch_id IS NOT NULL THEN 'scheduled'
      WHEN b.frz_id IS NOT NULL THEN 'frozen'
      ELSE 'inactive'
    END AS derived_status,
    COALESCE(b.act_id, b.sch_id, b.frz_id) AS ms_id,
    COALESCE(b.act_plan, b.sch_plan, b.frz_plan) AS ms_plan,
    COALESCE(b.act_start, b.sch_start, b.frz_start) AS ms_start,
    COALESCE(b.act_end, b.sch_end, b.frz_end) AS ms_end
  FROM base b
),
filtered AS (
  SELECT
    s.*,
    mp.name AS plan_name,
    CASE WHEN s.ms_end IS NOT NULL THEN (s.ms_end - s.today_d) + 1 ELSE NULL END AS days_left
  FROM shaped s
  LEFT JOIN public.membership_plans mp ON mp.id = s.ms_plan
  WHERE (p_search IS NULL OR btrim(p_search) = '' OR (
          s.full_name ILIKE '%' || btrim(p_search) || '%'
       OR s.member_code ILIKE '%' || btrim(p_search) || '%'
       OR s.email ILIKE '%' || btrim(p_search) || '%'
       OR s.phone ILIKE '%' || btrim(p_search) || '%'))
    AND (p_plan_id IS NULL OR s.ms_plan = p_plan_id)
    AND (p_joined_from IS NULL OR s.created_at >= p_joined_from)
    AND (p_joined_to IS NULL OR s.created_at < (p_joined_to + 1))
    AND (
      p_statuses IS NULL OR cardinality(p_statuses) = 0
      OR s.derived_status = ANY(p_statuses)
      OR ('expiring_soon' = ANY(p_statuses)
          AND s.derived_status = 'active'
          AND s.act_end IS NOT NULL
          AND (s.act_end - s.today_d) BETWEEN 0 AND 7)
      OR ('has_dues' = ANY(p_statuses) AND s.dues > 0)
    )
),
counted AS (SELECT COUNT(*)::bigint AS n FROM filtered)
SELECT
  f.id, f.member_code, f.user_id, f.lead_id, f.branch_id, f.branch_name, f.assigned_trainer_id,
  f.full_name, f.email, f.phone, f.avatar_url,
  f.derived_status,
  f.ms_id, f.ms_plan, f.plan_name, f.ms_start, f.ms_end,
  f.days_left, f.dues, f.created_at,
  (SELECT n FROM counted) AS total_count
FROM filtered f
ORDER BY
  CASE WHEN p_dir = 'asc' THEN
    CASE p_sort
      WHEN 'name' THEN LOWER(COALESCE(f.full_name,''))
      WHEN 'code' THEN LOWER(COALESCE(f.member_code,''))
      WHEN 'branch' THEN LOWER(COALESCE(f.branch_name,''))
      WHEN 'status' THEN f.derived_status
      WHEN 'membership' THEN LOWER(COALESCE(f.plan_name,''))
      ELSE NULL END
  END ASC NULLS LAST,
  CASE WHEN p_dir <> 'asc' THEN
    CASE p_sort
      WHEN 'name' THEN LOWER(COALESCE(f.full_name,''))
      WHEN 'code' THEN LOWER(COALESCE(f.member_code,''))
      WHEN 'branch' THEN LOWER(COALESCE(f.branch_name,''))
      WHEN 'status' THEN f.derived_status
      WHEN 'membership' THEN LOWER(COALESCE(f.plan_name,''))
      ELSE NULL END
  END DESC NULLS LAST,
  CASE WHEN p_dir = 'asc' THEN
    CASE p_sort
      WHEN 'days_left' THEN COALESCE(f.days_left, -999999)::numeric
      WHEN 'dues' THEN COALESCE(f.dues, 0)
      WHEN 'expiry' THEN COALESCE(EXTRACT(epoch FROM f.ms_end::timestamp), -999999)
      WHEN 'joined' THEN EXTRACT(epoch FROM f.created_at)
      ELSE NULL END
  END ASC NULLS LAST,
  CASE WHEN p_dir <> 'asc' THEN
    CASE p_sort
      WHEN 'days_left' THEN COALESCE(f.days_left, -999999)::numeric
      WHEN 'dues' THEN COALESCE(f.dues, 0)
      WHEN 'expiry' THEN COALESCE(EXTRACT(epoch FROM f.ms_end::timestamp), -999999)
      WHEN 'joined' THEN EXTRACT(epoch FROM f.created_at)
      ELSE NULL END
  END DESC NULLS LAST,
  f.created_at DESC
LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$function$;

REVOKE ALL ON FUNCTION public.list_members_page(uuid, text, text[], uuid, date, date, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_members_page(uuid, text, text[], uuid, date, date, text, text, integer, integer) TO authenticated, service_role;