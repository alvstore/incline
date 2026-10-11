CREATE OR REPLACE FUNCTION public.gate_access_drift(_branch_id uuid DEFAULT NULL)
RETURNS TABLE(member_id uuid, member_code text, full_name text, branch_id uuid,
  hardware_access_status text, hardware_access_reason text, hardware_access_enabled boolean,
  expected text, base_due numeric, other_due numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('gate_access_drift') AND NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners or admins can review gate rules' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT m.id, m.member_code, p.full_name, m.branch_id, m.hardware_access_status, m.hardware_access_reason,
           m.hardware_access_enabled,
           public.member_access_status(m.id, m.branch_id) AS st
    FROM public.members m
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.status = 'active'
      AND (_branch_id IS NULL OR m.branch_id = _branch_id)
      AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id = m.id
                  AND ms.status = 'active' AND ms.start_date <= current_date AND ms.end_date >= current_date)
      AND (m.hardware_access_reason = 'dues' OR m.hardware_access_status IN ('active','blocked_overdue','revoked'))
  )
  SELECT c.id, c.member_code, c.full_name, c.branch_id, c.hardware_access_status, c.hardware_access_reason,
         c.hardware_access_enabled,
         CASE WHEN (c.st->>'allowed')::boolean IS FALSE THEN 'locked' ELSE 'open' END,
         COALESCE(bd.base_due,0)::numeric,
         (COALESCE(bd.pt_due,0)+COALESCE(bd.store_due,0)+COALESCE(bd.addon_due,0))::numeric
  FROM c
  LEFT JOIN LATERAL public.member_overdue_breakdown(c.id, 0) bd ON true
  WHERE ((c.st->>'allowed')::boolean IS NOT FALSE
          AND c.hardware_access_reason = 'dues'
          AND (c.hardware_access_enabled = false OR c.hardware_access_status IN ('revoked','blocked_overdue')))
     OR ((c.st->>'allowed')::boolean IS FALSE AND c.hardware_access_status = 'active');
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_access_drift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_access_drift(uuid) TO authenticated, service_role;