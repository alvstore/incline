CREATE OR REPLACE FUNCTION public.can_write_shared_attachment(_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN true
    -- Trainers may upload plan PDFs only for members they can view.
    WHEN (storage.foldername(_object_name))[1] = 'fitness-plans'
         AND has_role(auth.uid(), 'trainer'::app_role)
         AND NOT has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role]) THEN
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id::text = (storage.foldername(_object_name))[2]
          AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
          AND public.trainer_can_view_member(auth.uid(), m.id)
      )
    WHEN NOT has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role]) THEN false
    WHEN (storage.foldername(_object_name))[1] = 'fitness-plans' THEN
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id::text = (storage.foldername(_object_name))[2]
          AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    WHEN (storage.foldername(_object_name))[1] IN ('fitness-templates','branch') THEN
      (storage.foldername(_object_name))[2] = 'global'
      OR public.storage_branch_segment_visible((storage.foldername(_object_name))[2])
    WHEN (storage.foldername(_object_name))[1] IN (
      'invoices','campaigns','whatsapp-attachments','misc','receipts','documents','plans','pos',
      'shared','roster','broadcasts'
    ) THEN
      NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'attachments' AND o.name = _object_name)
      OR EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'attachments' AND o.name = _object_name AND o.owner = auth.uid())
      OR public.can_read_attachment_object(_object_name)
    ELSE false
  END;
$function$;