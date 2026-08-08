-- 1) Retention thresholds: 5 / 10 / 21 days (was 3 / 7 / 14)
UPDATE public.retention_templates SET days_trigger = 5  WHERE stage_level = 1;
UPDATE public.retention_templates SET days_trigger = 10 WHERE stage_level = 2;
UPDATE public.retention_templates SET days_trigger = 21 WHERE stage_level = 3;

-- 2) Absence must account for turnstile/gate entries too. Members who badge in
--    at the gate but have no member_attendance row were being nudged as absent.
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
    GREATEST(ma.last_check_in, al.last_gate) AS last_visit,
    EXTRACT(
      DAY FROM (
        now() - COALESCE(
          GREATEST(ma.last_check_in, al.last_gate),
          ma.last_check_in,
          al.last_gate,
          m.joined_at::timestamptz,
          m.created_at
        )
      )
    )::integer AS days_absent
  FROM members m
  JOIN profiles p ON p.id = m.user_id
  JOIN memberships ms ON ms.member_id = m.id AND ms.status = 'active' AND ms.end_date >= CURRENT_DATE
  LEFT JOIN LATERAL (
    SELECT MAX(check_in) AS last_check_in
    FROM member_attendance att
    WHERE att.member_id = m.id
  ) ma ON true
  LEFT JOIN LATERAL (
    SELECT MAX(captured_at) AS last_gate
    FROM access_logs g
    WHERE g.member_id = m.id
      AND COALESCE(g.result, 'granted') NOT IN ('denied', 'blocked', 'rejected')
  ) al ON true
  WHERE m.branch_id = p_branch_id
    AND COALESCE(
          GREATEST(ma.last_check_in, al.last_gate),
          ma.last_check_in,
          al.last_gate,
          m.joined_at::timestamptz,
          m.created_at
        ) < now() - (p_days || ' days')::interval
    AND NOT EXISTS (
      SELECT 1 FROM memberships f
      WHERE f.member_id = m.id AND f.status = 'frozen'
    )
  ORDER BY COALESCE(
      GREATEST(ma.last_check_in, al.last_gate),
      ma.last_check_in,
      al.last_gate,
      m.joined_at::timestamptz,
      m.created_at
    ) ASC
  LIMIT p_limit;
END;
$function$;