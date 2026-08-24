ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS external_trainer_name text,
  ADD COLUMN IF NOT EXISTS venue text;

ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_trainer_xor_guest;
ALTER TABLE public.classes
  ADD CONSTRAINT classes_trainer_xor_guest
  CHECK (trainer_id IS NULL OR external_trainer_name IS NULL);

-- Staff may upload/replace class banner images (stored under the
-- class-banners/ prefix of the existing public template-media bucket).
DROP POLICY IF EXISTS class_banner_staff_write ON storage.objects;
CREATE POLICY class_banner_staff_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'template-media'
    AND name LIKE 'class-banners/%'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  );

DROP POLICY IF EXISTS class_banner_staff_update ON storage.objects;
CREATE POLICY class_banner_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'template-media'
    AND name LIKE 'class-banners/%'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  );

DROP POLICY IF EXISTS class_banner_staff_delete ON storage.objects;
CREATE POLICY class_banner_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'template-media'
    AND name LIKE 'class-banners/%'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  );