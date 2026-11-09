CREATE OR REPLACE FUNCTION public.payroll_future_commissions(p_item_id uuid)
RETURNS TABLE(installment_id uuid, payout_month date, amount numeric, member_name text, member_code text, package_name text, sale_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record;
BEGIN
  SELECT pi.id, pi.user_id, pi.status, pr.period_end, COALESCE(pr.branch_id, public.staff_primary_branch(pi.user_id)) AS b
    INTO v FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id=pi.run_id WHERE pi.id=p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;
  IF public.rpc_guard_applies('payroll_future_commissions') AND NOT public._pt_is_branch_manager(auth.uid(), v.b) THEN
    RAISE EXCEPTION 'Not authorised for this payroll' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT i.id, i.payout_month, i.installment_amount, COALESCE(p.full_name, m.member_code, 'Member'), m.member_code, pk.name, tc.sale_date
    FROM public.pt_commission_installments i
    JOIN public.trainers t ON t.id=i.trainer_id
    JOIN public.trainer_commissions tc ON tc.id=i.commission_id
    LEFT JOIN public.member_pt_packages mp ON mp.id=tc.pt_package_id
    LEFT JOIN public.pt_packages pk ON pk.id=mp.package_id
    LEFT JOIN public.invoices inv ON inv.id=mp.invoice_id
    LEFT JOIN public.members m ON m.id=COALESCE(tc.member_id, mp.member_id)
    LEFT JOIN public.profiles p ON p.id=m.user_id
   WHERE t.user_id=v.user_id AND i.status='pending' AND i.payroll_item_id IS NULL
     AND i.payout_month > v.period_end
     AND COALESCE(tc.kind,'earned')='earned' AND COALESCE(tc.status,'pending') NOT IN ('reversed','cancelled')
     AND (inv.id IS NULL OR GREATEST(COALESCE(inv.total_amount,0)-COALESCE(inv.amount_paid,0),0)=0)
     AND NOT EXISTS(SELECT 1 FROM public.payroll_items o WHERE o.status='processed' AND i.id=ANY(o.prepared_installment_ids))
   ORDER BY i.payout_month, 4;
END $$;

CREATE OR REPLACE FUNCTION public.payroll_pull_forward_installments(p_item_id uuid, p_installment_ids uuid[], p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record; n integer;
BEGIN
  SELECT pi.id, pi.run_id, pi.user_id, pi.status, pr.period_start, pr.period_end, COALESCE(pr.branch_id, public.staff_primary_branch(pi.user_id)) AS b
    INTO v FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id=pi.run_id WHERE pi.id=p_item_id FOR UPDATE OF pi;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;
  IF public.rpc_guard_applies('payroll_pull_forward_installments') AND NOT public._pt_is_branch_manager(auth.uid(), v.b) THEN
    RAISE EXCEPTION 'Not authorised for this payroll' USING ERRCODE='42501'; END IF;
  IF v.status NOT IN ('draft','approved') THEN RAISE EXCEPTION 'Only draft or approved salary slips can take extra commission'; END IF;
  IF COALESCE(trim(p_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  UPDATE public.pt_commission_installments i SET payout_month=date_trunc('month', v.period_start)::date, updated_at=now()
    FROM public.trainers t
   WHERE t.id=i.trainer_id AND t.user_id=v.user_id AND i.id=ANY(p_installment_ids)
     AND i.status='pending' AND i.payroll_item_id IS NULL AND i.payout_month > v.period_end
     AND NOT EXISTS(SELECT 1 FROM public.payroll_items o WHERE o.status='processed' AND i.id=ANY(o.prepared_installment_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> COALESCE(array_length(p_installment_ids,1),0) THEN RAISE EXCEPTION 'Some commissions are no longer available to pay early'; END IF;
  INSERT INTO public.payroll_audit(run_id,item_id,actor_id,action,reason,after_data)
  VALUES (v.run_id, v.id, auth.uid(), 'commission_pulled_forward', p_reason, jsonb_build_object('installment_ids', to_jsonb(p_installment_ids)));
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.payroll_future_commissions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_pull_forward_installments(uuid,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_future_commissions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payroll_pull_forward_installments(uuid,uuid[],text) TO authenticated, service_role;