DROP POLICY IF EXISTS "Attachments owner or admin can delete" ON storage.objects;

CREATE POLICY "Attachments owner or admin can delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'manager'::public.app_role)
      AND public.can_read_attachment_object(name)
    )
  )
);