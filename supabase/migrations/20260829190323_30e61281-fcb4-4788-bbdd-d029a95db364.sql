DROP POLICY IF EXISTS payroll_audit_admin_read ON public.payroll_audit;

CREATE POLICY payroll_audit_admin_read ON public.payroll_audit
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'owner'::app_role)
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.payroll_runs pr
        WHERE pr.id = payroll_audit.run_id
          AND pr.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.payroll_items pi
        JOIN public.payroll_runs pr2 ON pr2.id = pi.run_id
        WHERE pi.id = payroll_audit.item_id
          AND pr2.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
    )
  )
);