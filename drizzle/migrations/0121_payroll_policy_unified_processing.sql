ALTER TABLE public.hr_settings ADD COLUMN IF NOT EXISTS ot_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.hr_settings ADD COLUMN IF NOT EXISTS ot_eligible_roles text[] NOT NULL DEFAULT ARRAY['employee']::text[];
ALTER TABLE public.hr_settings ADD COLUMN IF NOT EXISTS ot_threshold_hours numeric NOT NULL DEFAULT 8.5;
ALTER TABLE public.hr_settings ADD CONSTRAINT hr_ot_policy_valid CHECK (ot_threshold_hours > 0 AND ot_threshold_hours <= 24 AND ot_multiplier > 0 AND ot_multiplier <= 5 AND ot_eligible_roles <@ ARRAY['employee','trainer']::text[]) NOT VALID;
ALTER TABLE public.trainers ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.trainers ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE public.trainers ADD COLUMN IF NOT EXISTS bank_ifsc text;
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS prepared_installment_ids uuid[];
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS snapshot_period_end date;
UPDATE public.payroll_items i SET snapshot_period_end=r.period_end FROM public.payroll_runs r WHERE r.id=i.run_id AND i.snapshot_period_end IS NULL;
CREATE INDEX IF NOT EXISTS payroll_lines_run_user_date_idx ON public.payroll_run_lines(run_id,user_id,work_date);

DO $patch$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.compute_payroll(uuid,date,date,uuid)'::regprocedure) INTO v;
 v := replace(v, 'v_frac := round(LEAST(v_attended::numeric / (v_rostered - v_leave_blocks)::numeric, 1), 2);', 'v_frac := round(LEAST((v_attended + CASE WHEN v_leave IN (''paid'',''sick'',''earned'',''comp_off'') THEN v_leave_blocks ELSE 0 END)::numeric / GREATEST(v_rostered,1)::numeric, 1), 2);');
 EXECUTE v;
 SELECT pg_get_functiondef('public.payroll_adjust_item(uuid,jsonb,text)'::regprocedure) INTO v;
 v := replace(v, 'final_base + final_pt_commission + final_bonus', 'final_base + final_pt_commission + final_ot + final_bonus');
 v := replace(v, 'BEGIN', 'BEGIN
  IF public.rpc_guard_applies(''payroll_adjust_item'') AND NOT EXISTS (
    SELECT 1 FROM public.payroll_items i JOIN public.payroll_runs r ON r.id=i.run_id
    WHERE i.id=p_item_id AND public._pt_is_branch_manager(auth.uid(),COALESCE(r.branch_id, public.staff_primary_branch(i.user_id)))
    AND (i.user_id<>auth.uid() OR public._gate_is_owner_admin())
  ) THEN RAISE EXCEPTION ''Not authorised for this payroll item'' USING ERRCODE=''42501''; END IF;
  PERFORM 1 FROM public.payroll_items WHERE id=p_item_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.payroll_items WHERE id=p_item_id AND status IN (''processed'',''paid'')) THEN RAISE EXCEPTION ''Processed or paid items cannot be adjusted''; END IF;');
 EXECUTE v;
END $patch$;

CREATE OR REPLACE FUNCTION public.payroll_calculation(p_user_id uuid,p_branch_id uuid,p_start date,p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.hr_settings%ROWTYPE; a record; v_kind text; v_salary numeric; v_hourly numeric; v_pt numeric; v_ot numeric:=0; v_rate numeric; v_gross numeric; v_ded jsonb; v_advance numeric; v_hours numeric:=0;
BEGIN
 IF public.rpc_guard_applies('payroll_calculation') AND NOT public._pt_is_branch_manager(auth.uid(),COALESCE(p_branch_id,public.staff_primary_branch(p_user_id))) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
 IF p_end<p_start OR p_end-p_start>62 THEN RAISE EXCEPTION 'Invalid payroll period'; END IF;
 SELECT * INTO a FROM public.payroll_summarize(p_user_id,p_start,p_end);
 SELECT 'trainer',fixed_salary,hourly_rate INTO v_kind,v_salary,v_hourly FROM public.trainers WHERE user_id=p_user_id AND COALESCE(is_active,true) LIMIT 1;
 IF v_kind IS NULL THEN SELECT 'employee',salary,NULL::numeric INTO v_kind,v_salary,v_hourly FROM public.employees WHERE user_id=p_user_id LIMIT 1; END IF;
 SELECT * INTO s FROM public.hr_settings WHERE branch_id=COALESCE(p_branch_id,public.staff_primary_branch(p_user_id)) OR branch_id IS NULL ORDER BY (branch_id IS NULL) LIMIT 1;
 IF COALESCE(s.ot_enabled,false) AND v_kind=ANY(COALESCE(s.ot_eligible_roles,'{}')) THEN
  SELECT COALESCE(sum(GREATEST(cp.hours_worked-s.ot_threshold_hours,0)),0) INTO v_hours FROM public.compute_payroll(p_user_id,p_start,p_end,NULL) cp WHERE cp.hours_source='actual' AND cp.status IN ('present','half_day');
  v_rate:=CASE WHEN COALESCE(v_hourly,0)>0 THEN v_hourly ELSE COALESCE(v_salary,0)/((p_end-p_start+1)*8.0) END;
  v_ot:=round(v_hours*v_rate*COALESCE(s.ot_multiplier,2),2);
 END IF;
 v_pt:=COALESCE(public.pt_commission_due_for_period(p_user_id,p_start,p_end),0);
 v_gross:=COALESCE(a.base,0)+v_pt+v_ot;
 v_ded:=public.payroll_statutory_deductions(COALESCE(p_branch_id,public.staff_primary_branch(p_user_id)),v_gross);
 v_advance:=public.payroll_advance_due(p_user_id,COALESCE(p_branch_id,public.staff_primary_branch(p_user_id)),v_gross-COALESCE((v_ded->>'total')::numeric,0),p_end);
 RETURN jsonb_build_object('base',COALESCE(a.base,0),'pt',v_pt,'ot',v_ot,'gross',v_gross,'deductions',COALESCE((v_ded->>'total')::numeric,0),'advance',v_advance,'net',round(GREATEST(v_gross-COALESCE((v_ded->>'total')::numeric,0)-v_advance,0),2),'attendance',COALESCE(a.attendance,'{}')||jsonb_build_object('ot_enabled',COALESCE(s.ot_enabled,false),'ot_hours',v_hours,'ot_hourly_rate',COALESCE(v_rate,0),'ot_multiplier',COALESCE(s.ot_multiplier,2),'ot_threshold_hours',COALESCE(s.ot_threshold_hours,8.5)),'breakdown',v_ded||jsonb_build_object('advance',v_advance));
END $$;
REVOKE ALL ON FUNCTION public.payroll_calculation(uuid,uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_calculation(uuid,uuid,date,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.payroll_recalculate_item(p_item_id uuid,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.payroll_items%ROWTYPE; r public.payroll_runs%ROWTYPE; c jsonb;
BEGIN
 SELECT * INTO i FROM public.payroll_items WHERE id=p_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=i.run_id FOR UPDATE;
 IF public.rpc_guard_applies('payroll_recalculate_item') AND (NOT public._pt_is_branch_manager(auth.uid(),COALESCE(r.branch_id,public.staff_primary_branch(i.user_id))) OR (i.user_id=auth.uid() AND NOT public._gate_is_owner_admin())) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
 IF i.status IN ('processed','paid') OR r.status IN ('processed','paid') THEN RAISE EXCEPTION 'Paid or processed payroll is immutable'; END IF;
 c:=public.payroll_calculation(i.user_id,r.branch_id,r.period_start,r.period_end);
 UPDATE public.payroll_items SET
 calc_base=(c->>'base')::numeric,calc_pt_commission=(c->>'pt')::numeric,calc_ot=(c->>'ot')::numeric,calc_gross=(c->>'gross')::numeric,calc_net=(c->>'net')::numeric,calc_deductions=(c->>'deductions')::numeric,calc_attendance=c->'attendance',calc_deduction_breakdown=c->'breakdown',
 final_base=CASE WHEN i.final_base IS DISTINCT FROM i.calc_base THEN i.final_base ELSE (c->>'base')::numeric END,
 final_pt_commission=CASE WHEN i.final_pt_commission IS DISTINCT FROM i.calc_pt_commission THEN i.final_pt_commission ELSE (c->>'pt')::numeric END,
 final_ot=CASE WHEN i.final_ot IS DISTINCT FROM i.calc_ot THEN i.final_ot ELSE (c->>'ot')::numeric END,
 final_deductions=CASE WHEN i.final_deductions IS DISTINCT FROM i.calc_deductions THEN i.final_deductions ELSE (c->>'deductions')::numeric END,
 final_advance=CASE WHEN i.final_advance IS DISTINCT FROM COALESCE((i.calc_deduction_breakdown->>'advance')::numeric,0) THEN i.final_advance ELSE (c->>'advance')::numeric END,
 status='draft',attendance_changed_at=NULL,snapshot_period_end=r.period_end,updated_at=now() WHERE id=i.id;
 UPDATE public.payroll_items SET final_gross=final_base+final_pt_commission+final_ot+final_bonus,final_net=round(final_base+final_pt_commission+final_ot+final_bonus-final_deductions-final_advance-final_penalty,2) WHERE id=i.id;
 INSERT INTO public.payroll_audit(run_id,item_id,actor_id,action,before_data,after_data,reason) SELECT i.run_id,i.id,auth.uid(),'recalculate_item',to_jsonb(i),to_jsonb(x),COALESCE(NULLIF(trim(p_reason),''),'Payroll attendance and policy corrected') FROM public.payroll_items x WHERE x.id=i.id;
END $$;
REVOKE ALL ON FUNCTION public.payroll_recalculate_item(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_recalculate_item(uuid,text) TO authenticated,service_role;

DO $patch$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.payroll_create_run(uuid,date,date)'::regprocedure) INTO v;
 v:=replace(v,'v_run_id uuid; v_user record; v_summary record;', 'v_run_id uuid; v_user record; v_summary record; v_calc jsonb;');
 v:=replace(v,'v_days := GREATEST((p_period_end - p_period_start) + 1, 1);','v_days := GREATEST((p_period_end - p_period_start) + 1, 1);
 IF public.rpc_guard_applies(''payroll_create_run'') AND NOT public._pt_is_branch_manager(auth.uid(),p_branch_id) THEN RAISE EXCEPTION ''Not authorised for this branch'' USING ERRCODE=''42501''; END IF;
 IF p_period_end<p_period_start OR p_period_end-p_period_start>62 THEN RAISE EXCEPTION ''Invalid payroll period''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(p_branch_id::text,''global'')||p_period_start::text,0));
 SELECT id INTO v_run_id FROM public.payroll_runs WHERE period_start=p_period_start AND period_end=p_period_end AND branch_id IS NOT DISTINCT FROM p_branch_id ORDER BY created_at DESC LIMIT 1;
 IF v_run_id IS NOT NULL THEN RETURN v_run_id; END IF;');
 v:=replace(v,'INSERT INTO public.payroll_items (','v_calc:=public.payroll_calculation(v_user.user_id,p_branch_id,p_period_start,p_period_end);
 v_summary.base:=(v_calc->>''base'')::numeric; v_pt:=(v_calc->>''pt'')::numeric; v_ot_pay:=(v_calc->>''ot'')::numeric;
 v_gross:=(v_calc->>''gross'')::numeric; v_ded_total:=(v_calc->>''deductions'')::numeric; v_advance:=(v_calc->>''advance'')::numeric; v_net:=(v_calc->>''net'')::numeric; v_att:=v_calc->''attendance''; v_ded:=v_calc->''breakdown'';
 INSERT INTO public.payroll_items (');
 v:=replace(v,'run_id, user_id, staff_kind,','run_id, user_id, staff_kind, snapshot_period_end,');
 v:=replace(v,'v_run_id, v_user.user_id, v_user.kind,','v_run_id, v_user.user_id, v_user.kind, p_period_end,');
 EXECUTE v;
 SELECT pg_get_functiondef('public.payroll_settle_item(uuid,uuid[],numeric,text,text,text)'::regprocedure) INTO v;
 v:=replace(v,'IF v_item.status = ''paid'' THEN', 'IF public.rpc_guard_applies(''payroll_settle_item'') AND NOT public._gate_is_owner_admin() THEN RAISE EXCEPTION ''Not authorised'' USING ERRCODE=''42501''; END IF;
 IF v_item.status<>''processed'' THEN RAISE EXCEPTION ''Process this salary before recording payment''; END IF;
 IF p_method NOT IN (''bank_transfer'',''cash'',''upi'',''cheque'') THEN RAISE EXCEPTION ''Invalid payment method''; END IF;
 IF COALESCE(p_adjustment,0)<>0 THEN RAISE EXCEPTION ''Save adjustments before processing salary''; END IF;
 IF v_item.status = ''paid'' THEN');
 v:=replace(v,'UPDATE public.payroll_runs r SET status', 'IF COALESCE(v_item.final_advance,0)>0 THEN PERFORM public.apply_advance_recovery(v_item.user_id,v_item.final_advance); END IF;
 UPDATE public.payroll_runs r SET status');
 EXECUTE v;
END $patch$;

CREATE OR REPLACE FUNCTION public.payroll_prepare_item(p_item_id uuid,p_installment_ids uuid[],p_patch jsonb,p_reason text,p_method text,p_bank jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.payroll_items%ROWTYPE; r public.payroll_runs%ROWTYPE; v_pt numeric; v_count integer; v_changed boolean;
BEGIN
 SELECT * INTO i FROM public.payroll_items WHERE id=p_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=i.run_id FOR UPDATE;
 IF public.rpc_guard_applies('payroll_prepare_item') AND NOT public._gate_is_owner_admin() THEN RAISE EXCEPTION 'Only owners/admins process salaries' USING ERRCODE='42501'; END IF;
 IF i.status IN ('processed','paid') THEN RAISE EXCEPTION 'Salary already processed or paid'; END IF;
 IF i.attendance_changed_at IS NOT NULL OR i.snapshot_period_end IS DISTINCT FROM r.period_end THEN RAISE EXCEPTION 'Recalculate changed attendance before processing'; END IF;
 IF p_method NOT IN ('cash','bank_transfer','upi','cheque') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
 SELECT COALESCE(sum(amount),0),count(*) INTO v_pt,v_count FROM public.payroll_item_pt_breakdown(i.id) WHERE NOT settled AND installment_id=ANY(COALESCE(p_installment_ids,'{}'));
 IF v_count<>COALESCE(cardinality(p_installment_ids),0) THEN RAISE EXCEPTION 'PT entries changed; refresh before processing'; END IF;
 v_changed:=EXISTS(SELECT 1 FROM jsonb_each_text(COALESCE(p_patch,'{}')) e WHERE (to_jsonb(i)->>e.key) IS DISTINCT FROM e.value);
 IF v_changed AND COALESCE(trim(p_reason),'')='' THEN RAISE EXCEPTION 'Adjustment reason required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(COALESCE(p_patch,'{}')) e WHERE e.key NOT IN ('final_base','final_ot','final_bonus','final_deductions','final_advance','final_penalty') OR e.value::numeric<0) THEN RAISE EXCEPTION 'Invalid salary component'; END IF;
 PERFORM public.payroll_adjust_item(i.id,COALESCE(p_patch,'{}')||jsonb_build_object('final_pt_commission',v_pt),COALESCE(NULLIF(trim(p_reason),''),'Salary reviewed for processing'));
 IF p_bank IS NOT NULL THEN
  IF i.staff_kind='trainer' THEN UPDATE public.trainers SET bank_name=NULLIF(trim(p_bank->>'bank_name'),''),bank_account=NULLIF(trim(p_bank->>'bank_account'),''),bank_ifsc=NULLIF(upper(trim(p_bank->>'bank_ifsc')),'') WHERE user_id=i.user_id;
  ELSE UPDATE public.employees SET bank_name=NULLIF(trim(p_bank->>'bank_name'),''),bank_account=NULLIF(trim(p_bank->>'bank_account'),''),bank_ifsc=NULLIF(upper(trim(p_bank->>'bank_ifsc')),'') WHERE user_id=i.user_id; END IF;
 END IF;
 UPDATE public.payroll_items SET status='processed',prepared_installment_ids=COALESCE(p_installment_ids,'{}'),payment_method=p_method,updated_at=now() WHERE id=i.id;
 INSERT INTO public.payroll_audit(run_id,item_id,actor_id,action,before_data,after_data,reason) SELECT i.run_id,i.id,auth.uid(),'salary_processed',to_jsonb(i),to_jsonb(x),p_reason FROM public.payroll_items x WHERE x.id=i.id;
 RETURN jsonb_build_object('success',true,'pt_total',v_pt);
END $$;
REVOKE ALL ON FUNCTION public.payroll_prepare_item(uuid,uuid[],jsonb,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_prepare_item(uuid,uuid[],jsonb,text,text,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.payroll_correct_period(p_run_id uuid,p_end date,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.payroll_runs%ROWTYPE; i record;
BEGIN
 IF public.rpc_guard_applies('payroll_correct_period') AND NOT public._gate_is_owner_admin() THEN RAISE EXCEPTION 'Only owners/admins correct payroll periods' USING ERRCODE='42501'; END IF;
 IF COALESCE(trim(p_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run not found'; END IF;
 IF p_end<>((date_trunc('month',r.period_start)+interval '1 month - 1 day')::date) OR p_end<r.period_end THEN RAISE EXCEPTION 'Only correction to calendar month end is allowed'; END IF;
 UPDATE public.payroll_runs SET period_end=p_end,notes=concat_ws(E'\n',notes,p_reason) WHERE id=r.id;
 FOR i IN SELECT id FROM public.payroll_items WHERE run_id=r.id AND status NOT IN ('processed','paid') LOOP PERFORM public.payroll_recalculate_item(i.id,p_reason); END LOOP;
 INSERT INTO public.payroll_audit(run_id,actor_id,action,before_data,after_data,reason) VALUES(r.id,auth.uid(),'period_corrected',jsonb_build_object('period_end',r.period_end),jsonb_build_object('period_end',p_end,'paid_snapshots_preserved',true),p_reason);
END $$;
REVOKE ALL ON FUNCTION public.payroll_correct_period(uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_correct_period(uuid,date,text) TO authenticated,service_role;