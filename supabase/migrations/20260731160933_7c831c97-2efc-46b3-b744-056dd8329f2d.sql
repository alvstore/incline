DROP POLICY IF EXISTS "Staff upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Users read own or staff read all documents" ON storage.objects;
DROP POLICY IF EXISTS "Staff delete documents" ON storage.objects;

CREATE POLICY "Branch scoped document uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
        AND public.has_capability(auth.uid(), 'view_member_documents')
    )
    OR (
      (storage.foldername(name))[1] = 'branches'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND ((storage.foldername(name))[2])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
      AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    )
  )
);

CREATE POLICY "Branch scoped document reads"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
        AND public.has_capability(auth.uid(), 'view_member_documents')
    )
    OR (
      (storage.foldername(name))[1] = 'branches'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND ((storage.foldername(name))[2])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
      AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    )
  )
);

CREATE POLICY "Branch scoped document deletes"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
        AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    )
    OR (
      (storage.foldername(name))[1] = 'branches'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND ((storage.foldername(name))[2])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
      AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
    )
  )
);

DROP POLICY IF EXISTS "Staff can upload payment slips" ON storage.objects;
DROP POLICY IF EXISTS "Staff can view payment slips" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update payment slips" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete payment slips" ON storage.objects;

CREATE POLICY "Branch staff upload payment slips"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-slips'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
  AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
);

CREATE POLICY "Branch staff view payment slips"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-slips'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
  AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
);

CREATE POLICY "Branch staff update payment slips"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'payment-slips'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
  AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
)
WITH CHECK (
  bucket_id = 'payment-slips'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
  AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
);

CREATE POLICY "Branch admins delete payment slips"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'payment-slips'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.user_visible_branch_ids(auth.uid()))
  AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
);