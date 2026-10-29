-- Exercise demo media (non-personal) is readable by any signed-in user so members
-- and the Flutter app can create short-lived signed URLs for their plan demos.
CREATE POLICY "exercisedb_authenticated_read_media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inclineexercisedb' AND name LIKE 'exercisedb/%');