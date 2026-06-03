
CREATE OR REPLACE FUNCTION public.get_upcoming_birthdays(
  p_days_ahead int DEFAULT 7,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(today jsonb, upcoming jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      m.id          AS member_id,
      m.user_id     AS user_id,
      m.member_code AS member_code,
      p.full_name   AS full_name,
      p.avatar_url  AS avatar_url,
      p.date_of_birth AS dob,
      CASE
        WHEN to_char(p.date_of_birth, 'MMDD') >= to_char(v_today, 'MMDD')
          THEN make_date(extract(year FROM v_today)::int,
                         extract(month FROM p.date_of_birth)::int,
                         LEAST(extract(day FROM p.date_of_birth)::int, 28))
        ELSE make_date(extract(year FROM v_today)::int + 1,
                       extract(month FROM p.date_of_birth)::int,
                       LEAST(extract(day FROM p.date_of_birth)::int, 28))
      END AS birthday_date
    FROM public.members m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE p.date_of_birth IS NOT NULL
      AND m.status = 'active'
      AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
  ),
  enriched AS (
    SELECT
      member_id, user_id, member_code, full_name, avatar_url, dob, birthday_date,
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
$$;

GRANT EXECUTE ON FUNCTION public.get_upcoming_birthdays(int, uuid) TO authenticated, service_role;
