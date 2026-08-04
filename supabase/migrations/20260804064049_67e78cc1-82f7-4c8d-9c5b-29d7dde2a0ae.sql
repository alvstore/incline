DROP FUNCTION IF EXISTS public.search_members(text, uuid, integer);

CREATE OR REPLACE FUNCTION public.search_members(search_term text, p_branch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, member_code text, full_name text, phone text, email text, avatar_url text, branch_id uuid, branch_name text, branch_code text, member_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized: Staff access required';
  END IF;

  IF p_branch_id IS NULL AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]) THEN
    SELECT sb.branch_id INTO p_branch_id FROM public.staff_branches sb WHERE sb.user_id = auth.uid() LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.member_code,
    COALESCE(p.full_name, l.full_name, 'Unknown') as full_name,
    COALESCE(p.phone, l.phone) as phone,
    COALESCE(p.email, l.email) as email,
    COALESCE(p.avatar_url, l.avatar_url) as avatar_url,
    m.branch_id,
    b.name as branch_name,
    b.code as branch_code,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.memberships ms
        WHERE ms.member_id = m.id
          AND ms.status = 'frozen'::public.membership_status
      ) THEN 'frozen'
      WHEN EXISTS (
        SELECT 1 FROM public.memberships ms
        WHERE ms.member_id = m.id
          AND ms.status = 'active'::public.membership_status
          AND ms.end_date >= CURRENT_DATE
      ) THEN 'active'
      ELSE 'inactive'
    END as member_status
  FROM public.members m
  LEFT JOIN public.profiles p ON m.user_id = p.id
  LEFT JOIN public.leads l ON m.lead_id = l.id
  LEFT JOIN public.branches b ON b.id = m.branch_id
  WHERE
    (p_branch_id IS NULL OR m.branch_id = p_branch_id)
    AND (
      m.member_code ILIKE '%' || search_term || '%'
      OR p.full_name ILIKE '%' || search_term || '%'
      OR p.phone ILIKE '%' || search_term || '%'
      OR p.email ILIKE '%' || search_term || '%'
      OR l.full_name ILIKE '%' || search_term || '%'
      OR l.phone ILIKE '%' || search_term || '%'
      OR l.email ILIKE '%' || search_term || '%'
    )
  ORDER BY COALESCE(p.full_name, l.full_name)
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_members(text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_members(text, uuid, integer) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='member_comps') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.member_comps;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='member_benefit_credits') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.member_benefit_credits;
  END IF;
END $$;