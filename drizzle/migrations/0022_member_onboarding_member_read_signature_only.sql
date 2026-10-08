DROP POLICY IF EXISTS "Member reads own onboarding files" ON storage.objects;
CREATE POLICY "Member reads own onboarding signature" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'member-onboarding' AND storage.filename(name) ILIKE 'signature%.png'
  AND EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = (SELECT auth.uid()) AND (storage.foldername(objects.name))[1] = m.id::text));