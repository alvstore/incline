CREATE OR REPLACE FUNCTION public._trainer_owns_member(p_user uuid, p_member uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trainers t JOIN public.members m ON m.id = p_member
    WHERE t.user_id = p_user AND (m.assigned_trainer_id = t.id OR EXISTS (
      SELECT 1 FROM public.member_pt_packages p WHERE p.member_id = m.id AND p.trainer_id = t.id
        AND p.status IN ('active','pending_payment'))));
$$;
REVOKE ALL ON FUNCTION public._trainer_owns_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._trainer_owns_member(uuid, uuid) TO service_role;

-- AI precaution guidance cache. Read/written only by the trainer-health-guidance backend function.
CREATE TABLE public.trainer_health_guidance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  generated_by uuid,
  conditions_hash text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trainer_health_guidance_member_idx ON public.trainer_health_guidance(member_id, created_at DESC);
GRANT ALL ON public.trainer_health_guidance TO service_role;
ALTER TABLE public.trainer_health_guidance ENABLE ROW LEVEL SECURITY;

-- Health questionnaire "yes" answers + age for the calling trainer's own client; logs the view.
CREATE OR REPLACE FUNCTION public.get_trainer_client_health(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_yes text[]; v_age int; v_branch uuid;
BEGIN
  IF public.rpc_guard_applies('get_trainer_client_health')
     AND NOT public._trainer_owns_member(auth.uid(), p_member_id) THEN
    RAISE EXCEPTION 'Not your client' USING ERRCODE = '42501';
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
  VALUES ('health_brief.viewed', 'members', p_member_id::text, auth.uid(), v_branch, 'Trainer viewed client health brief');
  RETURN jsonb_build_object('parq_yes', COALESCE(to_jsonb(v_yes), '[]'::jsonb), 'age', v_age);
END $$;
REVOKE ALL ON FUNCTION public.get_trainer_client_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trainer_client_health(uuid) TO authenticated, service_role;