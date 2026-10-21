CREATE OR REPLACE FUNCTION public.get_trainer_client_health(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_yes text[]; v_age int; v_branch uuid;
BEGIN
  IF public.rpc_guard_applies('get_trainer_client_health')
     AND NOT public._can_view_member_health(auth.uid(), p_member_id) THEN
    RAISE EXCEPTION 'Not allowed to view this member''s health' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_yes FROM (
    SELECT key AS k FROM (
      SELECT par_q FROM public.member_onboarding_signatures
      WHERE member_id = p_member_id ORDER BY signed_at DESC LIMIT 1) s,
      LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(s.par_q)='object' THEN s.par_q ELSE '{}'::jsonb END)
    WHERE lower(value) IN ('yes','true')) q;
  SELECT date_part('year', age(p.date_of_birth))::int, m.branch_id INTO v_age, v_branch
  FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = p_member_id;
  INSERT INTO public.audit_logs(action, table_name, record_id, user_id, branch_id, action_description)
  VALUES ('health_brief.viewed', 'members', p_member_id, auth.uid(), v_branch, 'Viewed client health brief');
  RETURN jsonb_build_object('parq_yes', COALESCE(to_jsonb(v_yes), '[]'::jsonb), 'age', v_age);
END $$;
REVOKE ALL ON FUNCTION public.get_trainer_client_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trainer_client_health(uuid) TO authenticated, service_role;