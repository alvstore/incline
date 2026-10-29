CREATE POLICY "exercisedb_owner_admin_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inclineexercisedb' AND (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])));
CREATE POLICY "exercisedb_owner_admin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'inclineexercisedb' AND (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])));
CREATE POLICY "exercisedb_owner_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'inclineexercisedb' AND (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])))
  WITH CHECK (bucket_id = 'inclineexercisedb' AND (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])));