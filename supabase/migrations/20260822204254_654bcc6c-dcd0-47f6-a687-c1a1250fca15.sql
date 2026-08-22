DROP POLICY IF EXISTS "Staff can read attachments in their branches" ON storage.objects;
DROP POLICY IF EXISTS "Attachments access control" ON storage.objects;

CREATE POLICY "Attachments branch scoped read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    owner = auth.uid()
    OR public.can_read_attachment_object(name)
  )
);