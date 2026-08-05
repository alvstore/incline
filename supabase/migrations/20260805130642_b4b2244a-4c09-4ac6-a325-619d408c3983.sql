-- 1) CLASSES: branch-scoped read
DROP POLICY IF EXISTS "View active classes" ON public.classes;
CREATE POLICY "View active classes" ON public.classes
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  OR branch_id = get_user_branch(auth.uid())
  OR branch_id = member_branch_id(get_member_id(auth.uid()))
);

-- 2) PRODUCTS: branch-scoped read (global catalog rows stay visible)
DROP POLICY IF EXISTS "view_products" ON public.products;
CREATE POLICY "view_products" ON public.products
FOR SELECT TO authenticated
USING (
  branch_id IS NULL
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  OR branch_id = get_user_branch(auth.uid())
  OR branch_id = member_branch_id(get_member_id(auth.uid()))
);

-- 3) MEMBER PT PACKAGES: split manager/staff from trainer scope
DROP POLICY IF EXISTS staff_write_member_pt_branch_scoped ON public.member_pt_packages;

CREATE POLICY staff_write_member_pt_branch_scoped ON public.member_pt_packages
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
  AND member_branch_id(member_id) IN (SELECT user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
  AND member_branch_id(member_id) IN (SELECT user_visible_branch_ids(auth.uid()))
);

-- Trainers: update only their own assigned clients' packages (no insert/delete)
CREATE POLICY trainer_update_own_client_pt ON public.member_pt_packages
FOR UPDATE TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.trainers t
    WHERE t.id = member_pt_packages.trainer_id AND t.user_id = auth.uid()
  )
  AND member_branch_id(member_id) IN (SELECT user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.trainers t
    WHERE t.id = member_pt_packages.trainer_id AND t.user_id = auth.uid()
  )
  AND member_branch_id(member_id) IN (SELECT user_visible_branch_ids(auth.uid()))
);

-- Guard: trainers may never alter financial fields
CREATE OR REPLACE FUNCTION public.block_trainer_pt_financial_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]) THEN
    RETURN NEW;
  END IF;
  IF has_any_role(auth.uid(), ARRAY['trainer'::app_role]) THEN
    IF NEW.price_paid IS DISTINCT FROM OLD.price_paid
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.gst_rate IS DISTINCT FROM OLD.gst_rate
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
       OR NEW.member_id IS DISTINCT FROM OLD.member_id THEN
      RAISE EXCEPTION 'Trainers cannot modify pricing, payment or assignment fields on PT packages';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_block_trainer_pt_financial_edit ON public.member_pt_packages;
CREATE TRIGGER tg_block_trainer_pt_financial_edit
BEFORE UPDATE ON public.member_pt_packages
FOR EACH ROW EXECUTE FUNCTION public.block_trainer_pt_financial_edit();

-- 4) STORAGE attachments: exact path match instead of LIKE pattern
DROP POLICY IF EXISTS "Attachments owner or staff can read" ON storage.objects;
CREATE POLICY "Attachments owner or staff can read" ON storage.objects
FOR SELECT
USING (
  bucket_id = 'attachments'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR owner = auth.uid()
    OR has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.attachment_url IS NOT NULL
        AND right(c.attachment_url, length(objects.name) + 1) = '/' || objects.name
        AND c.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);