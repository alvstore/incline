DROP POLICY IF EXISTS "Staff manage wallets" ON public.wallets;
CREATE POLICY "Staff manage wallets"
ON public.wallets
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = wallets.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = wallets.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Staff manage wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Staff manage wallet transactions"
ON public.wallet_transactions
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1
      FROM public.wallets w
      JOIN public.members m ON m.id = w.member_id
      WHERE w.id = wallet_transactions.wallet_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1
      FROM public.wallets w
      JOIN public.members m ON m.id = w.member_id
      WHERE w.id = wallet_transactions.wallet_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);