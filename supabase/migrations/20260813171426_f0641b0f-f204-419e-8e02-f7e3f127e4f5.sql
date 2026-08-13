CREATE OR REPLACE FUNCTION public.revoke_member_fitness_plan(p_plan_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_type text;
  v_member_id uuid;
  v_trainer_id uuid;
BEGIN
  -- Get plan info
  SELECT plan_type, member_id, created_by 
  INTO v_plan_type, v_member_id, v_trainer_id
  FROM public.member_fitness_plans
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Plan not found');
  END IF;

  -- Security check (managed via RLS policies on the table usually, but we enforce here for the atomic op)
  -- Allow owner/admin or the trainer who created it
  IF NOT (
    public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
    OR auth.uid() = v_trainer_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient permissions to revoke this plan');
  END IF;

  -- Soft delete (mark as invalid/expired) or hard delete? 
  -- We'll hard delete as these are assignments, and we want to clear the UI.
  DELETE FROM public.member_fitness_plans WHERE id = p_plan_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_member_fitness_plan(uuid) TO authenticated;
