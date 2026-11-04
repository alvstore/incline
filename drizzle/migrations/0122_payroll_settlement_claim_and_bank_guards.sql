DO $patch$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.payroll_settle_item(uuid,uuid[],numeric,text,text,text)'::regprocedure) INTO v;
 v:=replace(v,'SELECT array_agg(b.installment_id) INTO v_eligible','PERFORM 1 FROM public.pt_commission_installments WHERE id=ANY(COALESCE(p_installment_ids,''{}'')) ORDER BY id FOR UPDATE;
 IF p_installment_ids IS DISTINCT FROM v_item.prepared_installment_ids THEN RAISE EXCEPTION ''Use the PT entries saved when this salary was processed''; END IF;
 SELECT array_agg(b.installment_id) INTO v_eligible');
 v:=replace(v,'v_bonus := COALESCE(v_item.final_bonus,0)', 'IF round(v_pt,2)<>round(COALESCE(v_item.final_pt_commission,0),2) THEN RAISE EXCEPTION ''Commission amount changed since processing; review before payment''; END IF;
 v_bonus := COALESCE(v_item.final_bonus,0)');
 EXECUTE v;
 SELECT pg_get_functiondef('public.payroll_prepare_item(uuid,uuid[],jsonb,text,text,jsonb)'::regprocedure) INTO v;
 v:=replace(v,'SELECT COALESCE(sum(amount),0),count(*) INTO v_pt,v_count', 'PERFORM 1 FROM public.pt_commission_installments WHERE id=ANY(COALESCE(p_installment_ids,''{}'')) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.payroll_items x WHERE x.id<>i.id AND x.status=''processed'' AND x.prepared_installment_ids && COALESCE(p_installment_ids,''{}'')) THEN RAISE EXCEPTION ''PT entries are already reserved by another processed salary''; END IF;
 IF p_method=''bank_transfer'' AND (COALESCE(p_bank->>''bank_account'','''') !~ ''^[0-9]{6,24}$'' OR COALESCE(p_bank->>''bank_ifsc'','''') !~ ''^[A-Z]{4}0[A-Z0-9]{6}$'') THEN RAISE EXCEPTION ''Valid bank account and IFSC are required''; END IF;
 SELECT COALESCE(sum(amount),0),count(*) INTO v_pt,v_count');
 v:=replace(v,'IF p_bank IS NOT NULL THEN', 'IF p_bank IS NOT NULL AND p_method=''bank_transfer'' THEN');
 EXECUTE v;
 SELECT pg_get_functiondef('public.payroll_item_pt_breakdown(uuid)'::regprocedure) INTO v;
 v:=replace(v,'SELECT pi.*, pr.period_start, pr.period_end INTO v_item','IF public.rpc_guard_applies(''payroll_item_pt_breakdown'') AND NOT EXISTS(SELECT 1 FROM public.payroll_items i JOIN public.payroll_runs r ON r.id=i.run_id WHERE i.id=p_item_id AND public._pt_is_branch_manager(auth.uid(),COALESCE(r.branch_id,public.staff_primary_branch(i.user_id)))) THEN RAISE EXCEPTION ''Not authorised for this payroll'' USING ERRCODE=''42501''; END IF;
 SELECT pi.*, pr.period_start, pr.period_end INTO v_item');
 v:=replace(v,'AND i.payout_month >= date_trunc(''month'', v_item.period_start)::date','AND NOT EXISTS(SELECT 1 FROM public.payroll_items other WHERE other.id<>p_item_id AND other.status=''processed'' AND i.id=ANY(other.prepared_installment_ids))');
 EXECUTE v;
END $patch$;

CREATE OR REPLACE FUNCTION public.payroll_save_bank(p_item_id uuid,p_bank jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.payroll_items%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public.payroll_items WHERE id=p_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;
 IF public.rpc_guard_applies('payroll_save_bank') AND NOT public._gate_is_owner_admin() THEN RAISE EXCEPTION 'Only owners/admins edit remittance details' USING ERRCODE='42501'; END IF;
 IF COALESCE(p_bank->>'bank_account','') !~ '^[0-9]{6,24}$' OR COALESCE(p_bank->>'bank_ifsc','') !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'Valid account and IFSC required'; END IF;
 IF i.staff_kind='trainer' THEN UPDATE public.trainers SET bank_name=NULLIF(trim(p_bank->>'bank_name'),''),bank_account=p_bank->>'bank_account',bank_ifsc=p_bank->>'bank_ifsc',updated_at=now() WHERE user_id=i.user_id;
 ELSE UPDATE public.employees SET bank_name=NULLIF(trim(p_bank->>'bank_name'),''),bank_account=p_bank->>'bank_account',bank_ifsc=p_bank->>'bank_ifsc',updated_at=now() WHERE user_id=i.user_id; END IF;
 INSERT INTO public.payroll_audit(run_id,item_id,actor_id,action,after_data) VALUES(i.run_id,i.id,auth.uid(),'bank_details_updated',jsonb_build_object('bank_name',p_bank->>'bank_name','ifsc',p_bank->>'bank_ifsc','account_last_four',right(p_bank->>'bank_account',4)));
END $$;
REVOKE ALL ON FUNCTION public.payroll_save_bank(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_save_bank(uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.payroll_audit_ot_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.ot_enabled,NEW.ot_eligible_roles,NEW.ot_multiplier,NEW.ot_threshold_hours) IS DISTINCT FROM (OLD.ot_enabled,OLD.ot_eligible_roles,OLD.ot_multiplier,OLD.ot_threshold_hours) THEN
  INSERT INTO public.audit_logs(branch_id,user_id,action,table_name,record_id,old_values,new_values)
  VALUES(NEW.branch_id,auth.uid(),'payroll_overtime_policy_changed','hr_settings',NEW.id,
  jsonb_build_object('enabled',OLD.ot_enabled,'roles',OLD.ot_eligible_roles,'multiplier',OLD.ot_multiplier,'threshold',OLD.ot_threshold_hours),
  jsonb_build_object('enabled',NEW.ot_enabled,'roles',NEW.ot_eligible_roles,'multiplier',NEW.ot_multiplier,'threshold',NEW.ot_threshold_hours));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.payroll_audit_ot_policy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_audit_ot_policy() TO service_role;
CREATE TRIGGER payroll_audit_ot_policy AFTER UPDATE ON public.hr_settings FOR EACH ROW EXECUTE FUNCTION public.payroll_audit_ot_policy();