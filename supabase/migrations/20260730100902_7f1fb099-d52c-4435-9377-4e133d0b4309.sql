CREATE OR REPLACE FUNCTION public.get_todays_checkins(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  person_kind text,
  person_id uuid,
  full_name text,
  avatar_url text,
  member_code text,
  role_label text,
  branch_id uuid,
  check_in timestamptz,
  check_out timestamptz,
  dues numeric,
  days_remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH visible AS (
    SELECT public.user_visible_branch_ids(auth.uid()) AS bid
  ),
  member_rows AS (
    SELECT DISTINCT ON (ma.member_id)
      'member'::text AS person_kind,
      m.id AS person_id,
      COALESCE(p.full_name, m.member_code) AS full_name,
      COALESCE(p.avatar_url, m.biometric_photo_url) AS avatar_url,
      m.member_code,
      NULL::text AS role_label,
      ma.branch_id,
      ma.check_in,
      ma.check_out,
      COALESCE((
        SELECT SUM(i.total_amount - COALESCE(i.amount_paid, 0))
        FROM public.invoices i
        WHERE i.member_id = m.id
          AND i.status NOT IN ('cancelled'::invoice_status, 'paid'::invoice_status)
      ), 0)::numeric AS dues,
      (
        SELECT (ms.end_date - CURRENT_DATE)::int
        FROM public.memberships ms
        WHERE ms.member_id = m.id AND ms.status = 'active'
        ORDER BY ms.end_date DESC
        LIMIT 1
      ) AS days_remaining
    FROM public.member_attendance ma
    JOIN public.members m ON m.id = ma.member_id
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE ma.check_in >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
      AND (_branch_id IS NULL OR ma.branch_id = _branch_id)
      AND (ma.branch_id IN (SELECT bid FROM visible)
           OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
    ORDER BY ma.member_id, ma.check_in DESC
  ),
  staff_rows AS (
    SELECT DISTINCT ON (sa.user_id)
      'staff'::text AS person_kind,
      sa.user_id AS person_id,
      COALESCE(p.full_name, p.email, 'Staff') AS full_name,
      p.avatar_url,
      NULL::text AS member_code,
      COALESCE((
        SELECT ur.role::text FROM public.user_roles ur
        WHERE ur.user_id = sa.user_id
        ORDER BY CASE ur.role::text
          WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3
          WHEN 'trainer' THEN 4 ELSE 5 END
        LIMIT 1
      ), 'staff') AS role_label,
      sa.branch_id,
      sa.check_in,
      sa.check_out,
      NULL::numeric AS dues,
      NULL::int AS days_remaining
    FROM public.staff_attendance sa
    LEFT JOIN public.profiles p ON p.id = sa.user_id
    WHERE sa.check_in >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
      AND (_branch_id IS NULL OR sa.branch_id = _branch_id)
      AND (sa.branch_id IN (SELECT bid FROM visible)
           OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
    ORDER BY sa.user_id, sa.check_in DESC
  )
  SELECT * FROM member_rows
  UNION ALL
  SELECT * FROM staff_rows
  ORDER BY check_in DESC;
$$;

REVOKE ALL ON FUNCTION public.get_todays_checkins(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_checkins(uuid) TO authenticated;