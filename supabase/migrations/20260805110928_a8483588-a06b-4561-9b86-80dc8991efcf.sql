
-- Branch-scoped write access for managers/staff; owners & admins stay global.

-- benefit_slots
DROP POLICY IF EXISTS "Staff can manage slots" ON public.benefit_slots;
CREATE POLICY "Staff can manage slots" ON public.benefit_slots
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- ad_banners
DROP POLICY IF EXISTS "Admins can manage banners" ON public.ad_banners;
CREATE POLICY "Admins can manage banners" ON public.ad_banners
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- membership_plans
DROP POLICY IF EXISTS "Admin manage plans" ON public.membership_plans;
CREATE POLICY "Admin manage plans" ON public.membership_plans
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- pt_packages
DROP POLICY IF EXISTS "Admin manage pt packages" ON public.pt_packages;
CREATE POLICY "Admin manage pt packages" ON public.pt_packages
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- benefit_packages
DROP POLICY IF EXISTS "Admins can manage packages" ON public.benefit_packages;
CREATE POLICY "Admins can manage packages" ON public.benefit_packages
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- benefit_settings
DROP POLICY IF EXISTS "Admins can manage benefit settings" ON public.benefit_settings;
CREATE POLICY "Admins can manage benefit settings" ON public.benefit_settings
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- products
DROP POLICY IF EXISTS "admin_manage_products" ON public.products;
CREATE POLICY "admin_manage_products" ON public.products
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- product_batches
DROP POLICY IF EXISTS "manage_product_batches" ON public.product_batches;
CREATE POLICY "manage_product_batches" ON public.product_batches
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);
