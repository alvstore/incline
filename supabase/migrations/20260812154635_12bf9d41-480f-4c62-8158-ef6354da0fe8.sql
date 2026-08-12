DROP POLICY IF EXISTS "Staff can read plan attachments" ON storage.objects;
CREATE POLICY "Staff can read plan attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'plan-attachments'
  AND (
    public.has_role(auth.uid(), 'owner')
    OR EXISTS (
      SELECT 1
      FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
        AND (
          public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'manager')
          OR public.has_role(auth.uid(), 'staff')
          OR public.has_role(auth.uid(), 'trainer')
        )
    )
  )
);

DROP POLICY IF EXISTS "Staff can upload plan attachments" ON storage.objects;
CREATE POLICY "Staff can upload plan attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'plan-attachments'
  AND (
    public.has_role(auth.uid(), 'owner')
    OR EXISTS (
      SELECT 1
      FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
        AND (
          public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'manager')
          OR public.has_role(auth.uid(), 'staff')
          OR public.has_role(auth.uid(), 'trainer')
        )
    )
  )
);