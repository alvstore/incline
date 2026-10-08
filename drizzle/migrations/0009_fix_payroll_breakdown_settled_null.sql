CREATE OR REPLACE FUNCTION public.payroll_item_pt_breakdown(p_item_id uuid)
RETURNS TABLE (
  installment_id uuid, payout_month date, installment_index int, plan_months int,
  amount numeric, member_id uuid, member_name text, member_code text,
  package_name text, sale_date date, status text, settled boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_item record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT pi.*, pr.period_start, pr.period_end INTO v_item
    FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id = pi.run_id
   WHERE pi.id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;

  RETURN QUERY
  SELECT i.id, i.payout_month, i.installment_index, COALESCE(tc.plan_duration_months,1)::int,
         i.installment_amount, m.id, COALESCE(p.full_name, m.member_code, 'Member'), m.member_code,
         pk.name, tc.sale_date, i.status, COALESCE(i.payroll_item_id = p_item_id AND i.status = 'paid', false)
    FROM public.pt_commission_installments i
    JOIN public.trainers t ON t.id = i.trainer_id
    JOIN public.trainer_commissions tc ON tc.id = i.commission_id
    LEFT JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
    LEFT JOIN public.pt_packages pk ON pk.id = mp.package_id
    LEFT JOIN public.invoices inv ON inv.id = mp.invoice_id
    LEFT JOIN public.members m ON m.id = COALESCE(tc.member_id, mp.member_id)
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE t.user_id = v_item.user_id
     AND (
       i.payroll_item_id = p_item_id
       OR (
         i.status = 'pending' AND i.payroll_item_id IS NULL
         AND COALESCE(tc.kind,'earned') = 'earned'
         AND COALESCE(tc.status,'pending') NOT IN ('reversed','cancelled')
         AND (inv.id IS NULL OR GREATEST(COALESCE(inv.total_amount,0) - COALESCE(inv.amount_paid,0), 0) = 0)
         AND i.payout_month >= date_trunc('month', v_item.period_start)::date
         AND i.payout_month <= v_item.period_end
       )
     )
   ORDER BY i.payout_month, member_name;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_item_pt_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_item_pt_breakdown(uuid) TO authenticated, service_role;