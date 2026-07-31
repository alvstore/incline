DROP POLICY IF EXISTS "Attachments owner or staff can read" ON storage.objects;
CREATE POLICY "Attachments owner or staff can read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR owner = auth.uid()
    OR public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.attachment_url LIKE '%' || storage.objects.name || '%'
        AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "wa media read for staff" ON storage.objects;
CREATE POLICY "wa media read for staff"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_messages m
      WHERE m.media_url = storage.objects.name
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);