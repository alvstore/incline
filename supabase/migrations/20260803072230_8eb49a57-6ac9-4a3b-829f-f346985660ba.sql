DROP POLICY IF EXISTS "Staff can insert payment transactions" ON public.payment_transactions;

CREATE POLICY "payment_transactions_owner_admin_insert"
ON public.payment_transactions FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "payment_transactions_branch_staff_insert"
ON public.payment_transactions FOR INSERT TO authenticated
WITH CHECK (
  (has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);