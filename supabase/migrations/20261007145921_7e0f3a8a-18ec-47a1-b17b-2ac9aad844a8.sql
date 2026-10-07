CREATE OR REPLACE FUNCTION public.pt_commission_due_for_period(_user_id uuid, _period_start date, _period_end date)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(i.installment_amount), 0)
  FROM public.pt_commission_installments i
  JOIN public.trainers t ON t.id = i.trainer_id
  JOIN public.trainer_commissions tc ON tc.id = i.commission_id
  LEFT JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
  LEFT JOIN public.invoices inv ON inv.id = mp.invoice_id
  WHERE t.user_id = _user_id
    AND i.status = 'pending' AND i.payroll_item_id IS NULL
    AND COALESCE(tc.kind,'earned') = 'earned'
    AND COALESCE(tc.status,'pending') NOT IN ('reversed','cancelled')
    AND (inv.id IS NULL OR GREATEST(COALESCE(inv.total_amount,0) - COALESCE(inv.amount_paid,0), 0) = 0)
    AND i.payout_month <= _period_end;
$function$;

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
         pk.name, tc.sale_date, i.status, (i.payroll_item_id = p_item_id)
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
         AND i.payout_month <= v_item.period_end
       )
     )
   ORDER BY i.payout_month, member_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_mark_paid(p_item_ids uuid[], p_method text, p_reference text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners/admins can mark payroll as paid';
  END IF;
  UPDATE public.payroll_items
    SET status = 'paid', payment_method = p_method, payment_reference = p_reference, updated_at = now()
    WHERE id = ANY(p_item_ids) AND status = 'processed';
  FOR v_item IN
    SELECT pi.id, pi.user_id, pr.period_end
      FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id = pi.run_id
     WHERE pi.id = ANY(p_item_ids) AND pi.status = 'paid'
  LOOP
    UPDATE public.pt_commission_installments i
       SET status = 'paid', paid_at = now(), payroll_item_id = v_item.id, updated_at = now()
     WHERE i.id IN (
       SELECT i2.id FROM public.pt_commission_installments i2
         JOIN public.trainers t ON t.id = i2.trainer_id
         JOIN public.trainer_commissions tc ON tc.id = i2.commission_id
         LEFT JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
         LEFT JOIN public.invoices inv ON inv.id = mp.invoice_id
        WHERE t.user_id = v_item.user_id
          AND i2.status = 'pending' AND i2.payroll_item_id IS NULL
          AND COALESCE(tc.kind,'earned') = 'earned'
          AND COALESCE(tc.status,'pending') NOT IN ('reversed','cancelled')
          AND (inv.id IS NULL OR GREATEST(COALESCE(inv.total_amount,0) - COALESCE(inv.amount_paid,0), 0) = 0)
          AND i2.payout_month <= v_item.period_end);
  END LOOP;
  INSERT INTO public.payroll_audit (item_id, actor_id, action, after_data)
    SELECT unnest(p_item_ids), auth.uid(), 'item_paid', jsonb_build_object('method', p_method, 'reference', p_reference);
END;
$function$;