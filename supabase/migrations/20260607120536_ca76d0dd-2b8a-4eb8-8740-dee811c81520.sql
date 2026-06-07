
DROP POLICY IF EXISTS "Staff view branches" ON public.branches;
CREATE POLICY "Staff view branches" ON public.branches
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]));

DROP POLICY IF EXISTS "Authenticated can view active slots" ON public.benefit_slots;
CREATE POLICY "Authenticated can view active slots" ON public.benefit_slots
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (
      branch_id IS NULL
      OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
      OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "staff_access_expense_categories" ON public.expense_categories;
CREATE POLICY "staff_access_expense_categories" ON public.expense_categories
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]));

DROP POLICY IF EXISTS "hr_settings_staff_read" ON public.hr_settings;
CREATE POLICY "hr_settings_staff_read" ON public.hr_settings
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]));

DROP POLICY IF EXISTS "Product categories are viewable by authenticated users" ON public.product_categories;
CREATE POLICY "Product categories are viewable by staff" ON public.product_categories
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]));

DROP POLICY IF EXISTS "Authenticated users can upload attachments" ON storage.objects;

DROP POLICY IF EXISTS "Staff can write shared attachments" ON storage.objects;
CREATE POLICY "Staff can write shared attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
  );

DROP POLICY IF EXISTS "Authorized users can view member avatars" ON storage.objects;
CREATE POLICY "Authorized users can view member avatars" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND name LIKE 'avatars/%'
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
      OR split_part(substring(name from 'avatars/(.*)'), '-', 1) = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Authorized users can update member avatars" ON storage.objects;
CREATE POLICY "Authorized users can update member avatars" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND name LIKE 'avatars/%'
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
      OR split_part(substring(name from 'avatars/(.*)'), '-', 1) = auth.uid()::text
    )
  )
  WITH CHECK (
    bucket_id = 'member-photos'
    AND name LIKE 'avatars/%'
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
      OR split_part(substring(name from 'avatars/(.*)'), '-', 1) = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Authorized users can upload member avatars" ON storage.objects;
CREATE POLICY "Authorized users can upload member avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-photos'
    AND name LIKE 'avatars/%'
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
      OR split_part(substring(name from 'avatars/(.*)'), '-', 1) = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Staff can upload org-assets" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update org-assets" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete org-assets" ON storage.objects;

CREATE POLICY "Admins can upload org-assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-assets' AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admins can update org-assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'org-assets' AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]))
  WITH CHECK (bucket_id = 'org-assets' AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admins can delete org-assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'org-assets' AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]));
