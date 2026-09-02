-- Branch-scope storage write policies for attachments + template-media

CREATE OR REPLACE FUNCTION public.storage_branch_segment_visible(_seg text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _seg IS NULL THEN false
    WHEN _seg !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN false
    ELSE _seg::uuid IN (SELECT user_visible_branch_ids(auth.uid()))
  END;
$$;

-- Write-side counterpart of can_read_attachment_object
CREATE OR REPLACE FUNCTION public.can_write_shared_attachment(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN true
    WHEN NOT has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role]) THEN false

    -- Member-scoped folders: member's branch must be visible
    WHEN (storage.foldername(_object_name))[1] = 'fitness-plans' THEN
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id::text = (storage.foldername(_object_name))[2]
          AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )

    -- Branch-scoped folders: <prefix>/<branch_id|global>/...
    WHEN (storage.foldername(_object_name))[1] IN ('fitness-templates','branch') THEN
      (storage.foldername(_object_name))[2] = 'global'
      OR public.storage_branch_segment_visible((storage.foldername(_object_name))[2])

    -- Operational shared folders (no branch in the path); staff role required
    WHEN (storage.foldername(_object_name))[1] IN (
      'invoices','campaigns','whatsapp-attachments','misc','receipts','documents','plans','pos'
    ) THEN true

    ELSE false
  END;
$$;

DROP POLICY IF EXISTS "Staff can write shared attachments" ON storage.objects;
CREATE POLICY "Staff can write shared attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'attachments'
  AND public.can_write_shared_attachment(name)
);

-- template-media: manager writes must be branch-scoped
CREATE OR REPLACE FUNCTION public.can_write_template_media(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN true
    WHEN NOT has_role(auth.uid(), 'manager'::app_role) THEN false
    -- Managers may only touch their own branch folders
    ELSE public.storage_branch_segment_visible((storage.foldername(_object_name))[1])
  END;
$$;

-- Class banners live at class-banners/<branch_id>/<file>
CREATE OR REPLACE FUNCTION public.can_write_class_banner(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN true
    WHEN NOT has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role,'trainer'::app_role]) THEN false
    ELSE public.storage_branch_segment_visible((storage.foldername(_object_name))[2])
  END;
$$;

DROP POLICY IF EXISTS template_media_admin_write ON storage.objects;
DROP POLICY IF EXISTS template_media_admin_update ON storage.objects;
DROP POLICY IF EXISTS template_media_admin_delete ON storage.objects;
DROP POLICY IF EXISTS class_banner_staff_write ON storage.objects;
DROP POLICY IF EXISTS class_banner_staff_update ON storage.objects;
DROP POLICY IF EXISTS class_banner_staff_delete ON storage.objects;

CREATE POLICY template_media_admin_write ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'template-media' AND name NOT LIKE 'class-banners/%' AND public.can_write_template_media(name));

CREATE POLICY template_media_admin_update ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'template-media' AND name NOT LIKE 'class-banners/%' AND public.can_write_template_media(name))
WITH CHECK (bucket_id = 'template-media' AND name NOT LIKE 'class-banners/%' AND public.can_write_template_media(name));

CREATE POLICY template_media_admin_delete ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'template-media' AND name NOT LIKE 'class-banners/%' AND public.can_write_template_media(name));

CREATE POLICY class_banner_staff_write ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'template-media' AND name LIKE 'class-banners/%' AND public.can_write_class_banner(name));

CREATE POLICY class_banner_staff_update ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'template-media' AND name LIKE 'class-banners/%' AND public.can_write_class_banner(name))
WITH CHECK (bucket_id = 'template-media' AND name LIKE 'class-banners/%' AND public.can_write_class_banner(name));

CREATE POLICY class_banner_staff_delete ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'template-media' AND name LIKE 'class-banners/%' AND public.can_write_class_banner(name));
