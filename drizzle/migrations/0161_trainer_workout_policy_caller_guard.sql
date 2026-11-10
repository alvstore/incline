CREATE OR REPLACE FUNCTION public.trainer_can_read_member_runs(p_member uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_allowed boolean;
BEGIN
  v_allowed := v_user IS NOT NULL
    AND (SELECT public.has_role(v_user, 'trainer'::public.app_role))
    AND EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member
      AND m.branch_id IN (SELECT public.user_visible_branch_ids(v_user)))
    AND public._trainer_owns_member(v_user, p_member);
  IF public.rpc_guard_applies('trainer_can_read_member_runs') AND NOT v_allowed THEN
    RAISE EXCEPTION 'Not your client or branch' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(v_allowed, false);
END $$;
REVOKE ALL ON FUNCTION public.trainer_can_read_member_runs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_can_read_member_runs(uuid) TO authenticated, service_role;
ALTER POLICY "Trainer reads own clients runs" ON public.treadmill_workouts
USING (public.trainer_can_read_member_runs(member_id));
COMMENT ON FUNCTION public.trainer_can_read_member_runs(uuid) IS 'Caller-bound trainer workout policy helper; internal ownership helper stays service-only. Rollback: restore the previous trainer policy expression and revoke this wrapper.';