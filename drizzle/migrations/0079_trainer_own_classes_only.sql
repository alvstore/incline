CREATE OR REPLACE FUNCTION public.trainer_can_write_class(_branch uuid, _trainer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _trainer IS NOT NULL
    AND _trainer IN (SELECT t.id FROM public.trainers t WHERE t.user_id = auth.uid())
    AND COALESCE((
      SELECT NOT (s.value = 'false'::jsonb OR s.value->>'enabled' = 'false')
      FROM public.settings s
      WHERE s.key = 'trainer_class_self_manage' AND (s.branch_id = _branch OR s.branch_id IS NULL)
      ORDER BY s.branch_id NULLS LAST LIMIT 1), true)
$$;
REVOKE EXECUTE ON FUNCTION public.trainer_can_write_class(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_can_write_class(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff manage classes" ON public.classes;
CREATE POLICY "Staff manage classes" ON public.classes FOR ALL TO authenticated
USING (
  ((SELECT has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[]))
     OR ((SELECT has_any_role(auth.uid(), ARRAY['trainer']::app_role[])) AND public.trainer_can_write_class(branch_id, trainer_id)))
  AND (branch_id = (SELECT get_user_branch(auth.uid())) OR branch_id IN (SELECT managed_branch_ids(auth.uid())))
)
WITH CHECK (
  ((SELECT has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[]))
     OR ((SELECT has_any_role(auth.uid(), ARRAY['trainer']::app_role[])) AND public.trainer_can_write_class(branch_id, trainer_id)))
  AND (branch_id = (SELECT get_user_branch(auth.uid())) OR branch_id IN (SELECT managed_branch_ids(auth.uid())))
);