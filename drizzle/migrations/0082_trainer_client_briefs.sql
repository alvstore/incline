CREATE OR REPLACE FUNCTION public.get_trainer_client_briefs(p_member_ids uuid[] DEFAULT NULL)
RETURNS TABLE(member_id uuid, fitness_goals text, fitness_level text, health_conditions text,
  dietary_preference text, cuisine_preference text, equipment_availability text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_trainer uuid;
BEGIN
  SELECT t.id INTO v_trainer FROM public.trainers t WHERE t.user_id = auth.uid() LIMIT 1;
  IF public.rpc_guard_applies('get_trainer_client_briefs') AND v_trainer IS NULL THEN
    RAISE EXCEPTION 'Only trainers can read client briefs' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id, m.fitness_goals, m.fitness_level, m.health_conditions,
         m.dietary_preference, m.cuisine_preference, m.equipment_availability
  FROM public.members m
  WHERE (p_member_ids IS NULL OR m.id = ANY(p_member_ids))
    AND (m.assigned_trainer_id = v_trainer
      OR EXISTS (SELECT 1 FROM public.member_pt_packages p
                 WHERE p.member_id = m.id AND p.trainer_id = v_trainer
                   AND p.status IN ('active','pending_payment')));
END $$;
REVOKE ALL ON FUNCTION public.get_trainer_client_briefs(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trainer_client_briefs(uuid[]) TO authenticated, service_role;