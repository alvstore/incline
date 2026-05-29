
DROP POLICY IF EXISTS "Public read access for attachments" ON storage.objects;

DROP POLICY IF EXISTS "wa media read for authenticated" ON storage.objects;
CREATE POLICY "wa media read for staff" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (
    has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'staff'::app_role)
    OR has_role(auth.uid(), 'trainer'::app_role)
  )
);

DROP POLICY IF EXISTS "wa media insert for authenticated" ON storage.objects;
CREATE POLICY "wa media insert for staff" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND (
    has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'staff'::app_role)
    OR has_role(auth.uid(), 'trainer'::app_role)
  )
);

DROP POLICY IF EXISTS "staff_access_invoice_items" ON public.invoice_items;
CREATE POLICY "staff_access_invoice_items" ON public.invoice_items
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND i.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "staff_access_pos_sales" ON public.pos_sales;
CREATE POLICY "staff_access_pos_sales" ON public.pos_sales
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);
