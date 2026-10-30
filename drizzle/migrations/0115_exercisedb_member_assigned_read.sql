CREATE OR REPLACE FUNCTION public.member_can_read_exercise_media(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _path LIKE 'exercisedb/%'
    AND position('..' in _path) = 0
    AND public.exercise_demos_visible_for(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.members m
      JOIN public.member_fitness_plans p ON p.member_id = m.id
      WHERE m.user_id = auth.uid()
        AND p.plan_type = 'workout'
        AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
        AND strpos(p.plan_data::text, '"' || _path || '"') > 0
    )
$$;
REVOKE ALL ON FUNCTION public.member_can_read_exercise_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_can_read_exercise_media(text) TO authenticated;

DROP POLICY IF EXISTS "exercisedb_member_assigned_read" ON storage.objects;
CREATE POLICY "exercisedb_member_assigned_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inclineexercisedb' AND public.member_can_read_exercise_media(name));