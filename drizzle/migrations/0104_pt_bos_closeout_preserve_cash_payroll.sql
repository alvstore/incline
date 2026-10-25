CREATE TABLE public.pt_invoice_closeouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL UNIQUE REFERENCES public.invoices(id), branch_id uuid NOT NULL, member_package_id uuid NOT NULL REFERENCES public.member_pt_packages(id), commission_id uuid NOT NULL REFERENCES public.trainer_commissions(id), original_total numeric NOT NULL, retained_amount numeric NOT NULL, waived_amount numeric NOT NULL, commission_entitlement numeric NOT NULL, payroll_linked_commission numeric NOT NULL, confirmed_external_commission numeric NOT NULL DEFAULT 0, remaining_commission numeric NOT NULL, reason text NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL
);
GRANT SELECT ON public.pt_invoice_closeouts TO authenticated;
GRANT ALL ON public.pt_invoice_closeouts TO service_role;
ALTER TABLE public.pt_invoice_closeouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pt_closeout_financial_read ON public.pt_invoice_closeouts FOR SELECT TO authenticated USING ((SELECT public.has_capability(auth.uid(),'cancel_invoice')) AND ((SELECT public.has_capability(auth.uid(),'cross_branch_view')) OR branch_id IN (SELECT public.managed_branch_ids(auth.uid()))));
CREATE INDEX pt_closeouts_branch_date ON public.pt_invoice_closeouts(branch_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.closeout_pt_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL, p_external_commission numeric DEFAULT 0, p_expected_total numeric DEFAULT NULL, p_expected_paid numeric DEFAULT NULL, p_preview boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
 v_actor uuid := auth.uid(); v_inv public.invoices%ROWTYPE; v_pkg public.member_pt_packages%ROWTYPE; v_comm public.trainer_commissions%ROWTYPE; v_old public.pt_invoice_closeouts%ROWTYPE; v_flag jsonb; v_count int; v_paid numeric; v_net numeric; v_gross numeric; v_cut numeric; v_remaining numeric; v_index int; v_snapshot jsonb; v_result jsonb;
BEGIN
 -- Explicit direct-entry guard, plus mandatory authentication for every invocation.
 IF public.rpc_guard_applies('closeout_pt_invoice') AND v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 IF v_actor IS NULL OR NOT public.has_capability(v_actor,'cancel_invoice') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF NOT public.has_capability(v_actor,'cross_branch_view') AND NOT EXISTS (SELECT 1 FROM public.managed_branch_ids(v_actor) b WHERE b=v_inv.branch_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT value INTO v_flag FROM public.settings WHERE key='pt_invoice_closeout_enabled' AND branch_id=v_inv.branch_id LIMIT 1;
 IF v_flag IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_old FROM public.pt_invoice_closeouts WHERE invoice_id=p_invoice_id;
 IF FOUND THEN RETURN jsonb_build_object('already',true,'invoice_id',p_invoice_id,'retained_amount',v_old.retained_amount,'waived_amount',v_old.waived_amount,'commission_entitlement',v_old.commission_entitlement,'remaining_commission',v_old.remaining_commission); END IF;
 IF v_inv.is_gst_invoice IS DISTINCT FROM false OR COALESCE(v_inv.tax_amount,0)<>0 OR COALESCE(v_inv.gst_rate,0)<>0 OR v_inv.is_proforma OR v_inv.pos_sale_id IS NOT NULL THEN RAISE EXCEPTION 'bos_pt_only' USING ERRCODE='22023'; END IF;
 IF v_inv.status NOT IN ('partial','pending','overdue') OR COALESCE(v_inv.amount_paid,0)<=0 OR v_inv.total_amount<=v_inv.amount_paid THEN RAISE EXCEPTION 'not_partial' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_count FROM public.member_pt_packages WHERE invoice_id=p_invoice_id;
 IF v_count<>1 THEN RAISE EXCEPTION 'single_package_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_pkg FROM public.member_pt_packages WHERE invoice_id=p_invoice_id FOR UPDATE;
 IF v_pkg.status NOT IN ('active','expired','exhausted','pending_payment') THEN RAISE EXCEPTION 'package_closed' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id=p_invoice_id AND reference_type IS DISTINCT FROM 'pt_package') THEN RAISE EXCEPTION 'mixed_invoice' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_count FROM public.trainer_commissions WHERE pt_package_id=v_pkg.id AND COALESCE(kind,'earned')='earned' AND status NOT IN ('reversed','cancelled');
 IF v_count<>1 THEN RAISE EXCEPTION 'single_commission_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_comm FROM public.trainer_commissions WHERE pt_package_id=v_pkg.id AND COALESCE(kind,'earned')='earned' AND status NOT IN ('reversed','cancelled') FOR UPDATE;
 PERFORM id FROM public.pt_commission_installments WHERE commission_id=v_comm.id ORDER BY id FOR UPDATE;
 SELECT COALESCE(sum(installment_amount),0) INTO v_paid FROM public.pt_commission_installments WHERE commission_id=v_comm.id AND (status='paid' OR payroll_item_id IS NOT NULL);
 v_gross:=round(v_inv.amount_paid*COALESCE(v_comm.percentage,0)/100,2);
 -- Preserve the locked sale's deduction ratio; never introduce tax on a zero-deduction BOS commission.
 v_cut:=CASE WHEN COALESCE(v_comm.base_commission,0)>0 THEN round(v_gross*COALESCE(v_comm.gst_deduction,0)/v_comm.base_commission,2) ELSE 0 END;
 v_net:=v_gross-v_cut;
 IF p_external_commission IS NULL OR p_external_commission<0 OR p_external_commission<>round(p_external_commission,2) THEN RAISE EXCEPTION 'invalid_external_commission' USING ERRCODE='22023'; END IF;
 IF v_paid+p_external_commission>v_net THEN RAISE EXCEPTION 'commission_recovery_required' USING ERRCODE='22023'; END IF;
 v_remaining:=v_net-v_paid-p_external_commission;
 v_result:=jsonb_build_object('invoice_id',p_invoice_id,'invoice_number',v_inv.invoice_number,'original_total',v_inv.total_amount,'retained_amount',v_inv.amount_paid,'waived_amount',v_inv.total_amount-v_inv.amount_paid,'commission_entitlement',v_net,'payroll_linked_commission',v_paid,'confirmed_external_commission',p_external_commission,'remaining_commission',v_remaining,'sessions_used',v_pkg.sessions_used,'already',false);
 IF p_preview THEN RETURN v_result; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))<6 OR length(p_reason)>2000 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
 IF p_expected_total IS NULL OR p_expected_paid IS NULL OR p_expected_total<>v_inv.total_amount OR p_expected_paid<>v_inv.amount_paid THEN RAISE EXCEPTION 'stale_preview' USING ERRCODE='40001'; END IF;
 IF EXISTS (SELECT 1 FROM public.pt_sessions WHERE member_package_id=v_pkg.id AND status IN ('scheduled','rescheduled') AND scheduled_at>=now()) THEN RAISE EXCEPTION 'cancel_future_sessions_first' USING ERRCODE='22023'; END IF;
 v_snapshot:=jsonb_build_object('invoice',to_jsonb(v_inv),'package',to_jsonb(v_pkg),'commission',to_jsonb(v_comm),'installments',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') FROM public.pt_commission_installments x WHERE commission_id=v_comm.id),'payments',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'amount',amount,'status',status)),'[]') FROM public.payments WHERE invoice_id=p_invoice_id));
 -- Cancel obsolete unpaid amounts BEFORE the zero-balance invoice update can release them.
 UPDATE public.pt_commission_installments SET status='cancelled',blocked_reason='PT closeout: '||trim(p_reason),updated_at=now() WHERE commission_id=v_comm.id AND status IN ('pending','blocked') AND payroll_item_id IS NULL;
 UPDATE public.trainer_commissions SET total_sale_amount=v_inv.amount_paid,base_commission=v_gross,gst_deduction=v_cut,net_total_commission=v_net,amount=v_net,notes=COALESCE(notes,'')||' | PT closeout: '||trim(p_reason) WHERE id=v_comm.id;
 IF v_remaining>0 THEN
 SELECT COALESCE(max(installment_index),0)+1 INTO v_index FROM public.pt_commission_installments WHERE commission_id=v_comm.id;
 INSERT INTO public.pt_commission_installments(commission_id,trainer_id,branch_id,payout_month,installment_index,installment_amount,status) VALUES(v_comm.id,v_comm.trainer_id,v_inv.branch_id,date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')::date,v_index,v_remaining,'pending');
 END IF;
 UPDATE public.member_pt_packages SET status='cancelled',sessions_remaining=0,price_paid=v_inv.amount_paid,subtotal=v_inv.amount_paid,payment_status='paid',updated_at=now() WHERE id=v_pkg.id;
 UPDATE public.invoices SET discount_amount=COALESCE(discount_amount,0)+(total_amount-amount_paid),total_amount=amount_paid,status='paid',next_reminder_at=NULL,notes=COALESCE(notes,'')||E'\nPT closed — remaining balance waived: '||trim(p_reason),updated_at=now() WHERE id=p_invoice_id;
 INSERT INTO public.pt_invoice_closeouts(invoice_id,branch_id,member_package_id,commission_id,original_total,retained_amount,waived_amount,commission_entitlement,payroll_linked_commission,confirmed_external_commission,remaining_commission,reason,actor_id,snapshot) VALUES(p_invoice_id,v_inv.branch_id,v_pkg.id,v_comm.id,v_inv.total_amount,v_inv.amount_paid,v_inv.total_amount-v_inv.amount_paid,v_net,v_paid,p_external_commission,v_remaining,trim(p_reason),v_actor,v_snapshot);
 INSERT INTO public.audit_logs(user_id,branch_id,action,table_name,record_id,old_data,new_data,action_description) VALUES(v_actor,v_inv.branch_id,'PT_INVOICE_CLOSEOUT','invoices',p_invoice_id,v_snapshot,v_result||jsonb_build_object('reason',trim(p_reason),'external_payment_is_owner_confirmation',true),'PT invoice '||v_inv.invoice_number||' closed; receipts preserved; outstanding balance waived');
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.closeout_pt_invoice(uuid,text,numeric,numeric,numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.closeout_pt_invoice(uuid,text,numeric,numeric,numeric,boolean) TO authenticated,service_role;
COMMENT ON TABLE public.pt_invoice_closeouts IS 'Append-only closeout evidence. External commission is operator-confirmed historical payment, not a new payroll payment or cash transaction. GST invoices use a separate credit-note workflow.';