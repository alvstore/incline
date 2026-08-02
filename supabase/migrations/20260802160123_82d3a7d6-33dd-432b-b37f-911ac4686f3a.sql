DROP POLICY IF EXISTS "staff_access_inventory" ON public.inventory;
CREATE POLICY "inventory_branch_scoped_access" ON public.inventory
FOR ALL TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Staff can view stock movements" ON public.stock_movements;
CREATE POLICY "stock_movements_branch_scoped_select" ON public.stock_movements
FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Staff can insert stock movements" ON public.stock_movements;
CREATE POLICY "stock_movements_branch_scoped_insert" ON public.stock_movements
FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);