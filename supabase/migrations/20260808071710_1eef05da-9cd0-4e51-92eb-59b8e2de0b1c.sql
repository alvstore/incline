
-- 1. Holidays: restrict read to staff roles
DROP POLICY IF EXISTS holidays_read_all ON public.holidays;
CREATE POLICY holidays_read_staff ON public.holidays
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::app_role[]));

-- 2. Financial taxonomies: restrict read to staff roles
DROP POLICY IF EXISTS "Authenticated users can read income categories" ON public.income_categories;
CREATE POLICY income_categories_staff_read ON public.income_categories
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::app_role[]));

DROP POLICY IF EXISTS "Authenticated can view expense categories" ON public.expense_category_templates;
CREATE POLICY expense_category_templates_staff_read ON public.expense_category_templates
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::app_role[]));

-- 3. Role capability matrix: admin/owner only
DROP POLICY IF EXISTS "all auth read capabilities" ON public.role_capabilities;
CREATE POLICY role_capabilities_admin_read ON public.role_capabilities
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]));

-- 4. Shared attachments bucket: uploader / object owner / owner-admin / branch-scoped campaign match
DROP POLICY IF EXISTS "Attachments owner or staff can read" ON storage.objects;
CREATE POLICY "Attachments owner or scoped staff can read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR owner = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[])
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.attachment_url IS NOT NULL
        AND right(c.attachment_url, length(objects.name) + 1) = ('/' || objects.name)
        AND c.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);
