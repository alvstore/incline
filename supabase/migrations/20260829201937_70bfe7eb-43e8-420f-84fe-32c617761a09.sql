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
      pe.branch_id    AS branch_id,
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
      member_id, user_id, member_code, person_type, branch_id, full_name, avatar_url, dob, birthday_date,
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