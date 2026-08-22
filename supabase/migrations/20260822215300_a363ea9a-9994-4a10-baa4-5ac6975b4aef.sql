CREATE OR REPLACE FUNCTION public.can_read_attachment_object(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN true

      -- Member fitness plans: branch of the owning member must be visible.
      WHEN (storage.foldername(_object_name))[1] = 'fitness-plans' THEN
        EXISTS (
          SELECT 1 FROM public.members m
          WHERE m.id::text = (storage.foldername(_object_name))[2]
            AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
            AND (
              has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
              OR (has_role(auth.uid(), 'trainer'::app_role) AND public.trainer_can_view_member(auth.uid(), m.id))
            )
        )

      -- Invoice PDFs: filename embeds the invoice number; resolve its branch.
      WHEN (storage.foldername(_object_name))[1] = 'invoices' THEN
        has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.invoice_number IS NOT NULL
            AND position(i.invoice_number in _object_name) > 0
            AND i.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
        )

      -- Campaign creatives: resolve the owning campaign's branch.
      WHEN (storage.foldername(_object_name))[1] = 'campaigns' THEN
        has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND EXISTS (
          SELECT 1 FROM public.campaigns c
          WHERE c.attachment_url IS NOT NULL
            AND position(_object_name in c.attachment_url) > 0
            AND (
              c.branch_id IS NULL
              OR c.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
            )
        )

      -- Unknown path shapes are owner/admin only (fail closed).
      ELSE false
    END;
$function$;