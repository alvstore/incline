DROP POLICY IF EXISTS "exercisedb_authenticated_read_media" ON storage.objects;
CREATE POLICY "exercisedb_staff_read_media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inclineexercisedb' AND name LIKE 'exercisedb/%'
    AND (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','trainer','staff']::text[])));

-- Effective demo visibility for a user: staff roles always; members only when their branch switch is on.
CREATE OR REPLACE FUNCTION public.exercise_demos_visible_for(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN public.has_any_role(_user_id, ARRAY['owner','admin','manager','trainer','staff']::text[]) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.members m
      JOIN public.settings s ON s.branch_id = m.branch_id AND s.key = 'member_exercise_demos_enabled'
      WHERE m.user_id = _user_id AND COALESCE((s.value #>> '{}')::boolean, false)
    )
  END
$$;
REVOKE ALL ON FUNCTION public.exercise_demos_visible_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exercise_demos_visible_for(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_view_exercise_demos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.exercise_demos_visible_for(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.can_view_exercise_demos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_exercise_demos() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_member_exercise_demos(p_branch_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('get_member_exercise_demos')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::text[]) THEN
    RAISE EXCEPTION 'Only owners and admins can view this setting' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT (value #>> '{}')::boolean FROM public.settings
    WHERE branch_id = p_branch_id AND key = 'member_exercise_demos_enabled'), false);
END $$;
REVOKE ALL ON FUNCTION public.get_member_exercise_demos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_exercise_demos(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_member_exercise_demos(p_branch_id uuid, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old boolean;
BEGIN
  IF public.rpc_guard_applies('set_member_exercise_demos')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::text[]) THEN
    RAISE EXCEPTION 'Only owners and admins can change this setting' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Branch is required'; END IF;
  SELECT (value #>> '{}')::boolean INTO v_old FROM public.settings
    WHERE branch_id = p_branch_id AND key = 'member_exercise_demos_enabled';
  INSERT INTO public.settings (branch_id, key, value, description)
  VALUES (p_branch_id, 'member_exercise_demos_enabled', to_jsonb(p_enabled), 'Members can see exercise demo pictures and videos')
  ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, old_data, new_data, action_description)
  VALUES (p_branch_id, auth.uid(), 'MEMBER_EXERCISE_DEMOS_TOGGLED', 'settings',
    jsonb_build_object('enabled', COALESCE(v_old, false)), jsonb_build_object('enabled', p_enabled),
    CASE WHEN p_enabled THEN 'Turned on exercise demos for members' ELSE 'Turned off exercise demos for members' END);
  RETURN p_enabled;
END $$;
REVOKE ALL ON FUNCTION public.set_member_exercise_demos(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_exercise_demos(uuid, boolean) TO authenticated;