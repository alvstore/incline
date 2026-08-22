-- 1) Attachments: an "owner" must be the real storage object owner, not just
--    anyone able to construct a path whose first folder is their own uid.
DROP POLICY IF EXISTS "Attachments owner can update" ON storage.objects;
CREATE POLICY "Attachments owner can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'attachments'
    AND owner = auth.uid()
    AND (auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'attachments'
    AND owner = auth.uid()
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Attachments owner or admin can delete" ON storage.objects;
CREATE POLICY "Attachments owner or admin can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (
      owner = auth.uid()
      OR has_role(auth.uid(), 'owner'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
    )
  );

-- 2) Lab reports live under "<product_id>/..." — scope staff reads to the
--    branches they are allowed to see, matching product/batch RLS.
DROP POLICY IF EXISTS "lab_reports_view" ON storage.objects;
CREATE POLICY "lab_reports_view"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'product-lab-reports'
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
      OR EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.id::text = (storage.foldername(storage.objects.name))[1]
          AND has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
          AND (
            p.branch_id IS NULL
            OR p.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
          )
      )
    )
  );

-- 3) Policy PDFs: storage policies are OR'd, so the broad "any member" read
--    defeated the precise role/branch check. Keep only can_read_policy_pdf.
DROP POLICY IF EXISTS "policy_pdfs_read_scoped" ON storage.objects;