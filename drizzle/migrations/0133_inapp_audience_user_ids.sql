CREATE OR REPLACE FUNCTION public.inapp_audience_user_ids(p_branch_id uuid, p_audience text)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('inapp_audience_user_ids') AND NOT public.is_branch_staff(p_branch_id, false) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT u FROM (
    SELECT m.user_id AS u FROM members m
     WHERE m.branch_id = p_branch_id AND m.user_id IS NOT NULL
       AND (p_audience IN ('all','members_and_staff')
            OR (p_audience IN ('active','members_and_staff_active') AND EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status IN ('active','frozen')))
            OR (p_audience = 'expiring' AND EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status='active' AND ms.end_date BETWEEN current_date AND current_date + 7))
            OR (p_audience = 'expired' AND NOT EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status IN ('active','frozen'))))
    UNION
    SELECT sb.user_id FROM staff_branches sb WHERE sb.branch_id = p_branch_id AND p_audience IN ('members_and_staff','members_and_staff_active','staff')
    UNION
    SELECT t.user_id FROM trainers t WHERE t.branch_id = p_branch_id AND t.is_active AND t.user_id IS NOT NULL AND p_audience IN ('members_and_staff','members_and_staff_active','staff')
    UNION
    SELECT bm.user_id FROM branch_managers bm WHERE bm.branch_id = p_branch_id AND p_audience IN ('members_and_staff','members_and_staff_active','staff')
  ) s(u) WHERE u IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.inapp_audience_user_ids(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inapp_audience_user_ids(uuid, text) TO authenticated, service_role;