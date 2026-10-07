-- Itemised PT settlement: every rupee of PT commission on a payslip is tied to a client + month.
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
         AND i.payout_month >= date_trunc('month', v_item.period_start)::date
         AND i.payout_month <= v_item.period_end
       )
     )
   ORDER BY i.payout_month, member_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_settle_item(
  p_item_id uuid, p_installment_ids uuid[], p_adjustment numeric,
  p_reason text, p_method text, p_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item record; v_pt numeric := 0; v_count int := 0; v_eligible uuid[];
  v_bonus numeric; v_penalty numeric; v_gross numeric; v_net numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners/admins can settle payroll';
  END IF;
  SELECT * INTO v_item FROM public.payroll_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;
  IF v_item.status = 'paid' THEN RAISE EXCEPTION 'This payslip is already paid'; END IF;

  SELECT array_agg(b.installment_id) INTO v_eligible
    FROM public.payroll_item_pt_breakdown(p_item_id) b WHERE NOT b.settled;

  SELECT COALESCE(SUM(i.installment_amount),0), COUNT(*) INTO v_pt, v_count
    FROM public.pt_commission_installments i
   WHERE i.id = ANY(COALESCE(p_installment_ids,'{}')) AND i.id = ANY(COALESCE(v_eligible,'{}'));

  IF v_count <> COALESCE(array_length(p_installment_ids,1),0) THEN
    RAISE EXCEPTION 'Some selected PT sessions are no longer eligible — refresh and try again';
  END IF;

  v_bonus := COALESCE(v_item.final_bonus,0) + GREATEST(COALESCE(p_adjustment,0),0);
  v_penalty := COALESCE(v_item.final_penalty,0) + GREATEST(-COALESCE(p_adjustment,0),0);
  v_gross := COALESCE(v_item.final_base,0) + v_pt + COALESCE(v_item.final_ot,0) + v_bonus;
  v_net := round(v_gross - (COALESCE(v_item.final_deductions,0) + COALESCE(v_item.final_advance,0) + v_penalty), 2);

  UPDATE public.payroll_items SET
    final_pt_commission = v_pt, final_bonus = v_bonus, final_penalty = v_penalty,
    final_gross = v_gross, final_net = v_net,
    adjustment_reason = COALESCE(NULLIF(trim(p_reason),''), adjustment_reason),
    status = 'paid', payment_method = p_method, payment_reference = p_reference, updated_at = now()
  WHERE id = p_item_id;

  UPDATE public.pt_commission_installments
     SET status = 'paid', paid_at = now(), payroll_item_id = p_item_id, updated_at = now()
   WHERE id = ANY(COALESCE(p_installment_ids,'{}'));

  UPDATE public.payroll_runs r SET status = 'paid', paid_at = now()
   WHERE r.id = v_item.run_id
     AND NOT EXISTS (SELECT 1 FROM public.payroll_items x WHERE x.run_id = r.id AND x.status <> 'paid');

  INSERT INTO public.payroll_audit (item_id, actor_id, action, after_data)
  VALUES (p_item_id, auth.uid(), 'item_settled', jsonb_build_object(
    'installment_ids', p_installment_ids, 'pt_total', v_pt, 'adjustment', p_adjustment,
    'reason', p_reason, 'method', p_method, 'reference', p_reference, 'net', v_net));

  RETURN jsonb_build_object('net', v_net, 'pt_total', v_pt, 'settled_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_item_pt_breakdown(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_settle_item(uuid,uuid[],numeric,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_item_pt_breakdown(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payroll_settle_item(uuid,uuid[],numeric,text,text,text) TO authenticated, service_role;