CREATE OR REPLACE FUNCTION public.get_inactive_members(p_branch_id uuid, p_days integer DEFAULT 7, p_limit integer DEFAULT 50)
 RETURNS TABLE(member_id uuid, member_code text, full_name text, phone text, email text, avatar_url text, last_visit timestamp with time zone, days_absent integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    m.id AS member_id,
    m.member_code,
    COALESCE(p.full_name, 'Unknown') AS full_name,
    p.phone,
    p.email,
    p.avatar_url,
    ma.last_check_in AS last_visit,
    -- Never-visited members are measured from their join date, not epoch,
    -- so a member who registered yesterday is not reported as "21+ days".
    EXTRACT(
      DAY FROM (now() - COALESCE(ma.last_check_in, m.joined_at::timestamptz, m.created_at))
    )::integer AS days_absent
  FROM members m
  JOIN profiles p ON p.id = m.user_id
  JOIN memberships ms ON ms.member_id = m.id AND ms.status = 'active' AND ms.end_date >= CURRENT_DATE
  LEFT JOIN LATERAL (
    SELECT MAX(check_in) AS last_check_in
    FROM member_attendance att
    WHERE att.member_id = m.id
  ) ma ON true
  WHERE m.branch_id = p_branch_id
    AND COALESCE(ma.last_check_in, m.joined_at::timestamptz, m.created_at)
        < now() - (p_days || ' days')::interval
    AND NOT EXISTS (
      SELECT 1 FROM memberships f
      WHERE f.member_id = m.id AND f.status = 'frozen'
    )
  ORDER BY COALESCE(ma.last_check_in, m.joined_at::timestamptz, m.created_at) ASC
  LIMIT p_limit;
END;
$function$;