ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payroll_item_id uuid REFERENCES public.payroll_items(id);
CREATE UNIQUE INDEX IF NOT EXISTS expenses_one_per_payroll_item ON public.expenses(payroll_item_id) WHERE payroll_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.payroll_record_salary_expense() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_branch uuid; v_start date; v_end date; v_name text;
BEGIN
 IF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
  SELECT COALESCE(r.branch_id,public.staff_primary_branch(NEW.user_id)),r.period_start,r.period_end INTO v_branch,v_start,v_end FROM public.payroll_runs r WHERE r.id=NEW.run_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Assign this salary to a branch before recording payment'; END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE id=NEW.user_id;
  INSERT INTO public.expenses(branch_id,amount,description,expense_date,status,submitted_by,approved_by,approved_at,payment_method,payment_reference,paid_at,paid_by,is_paid,employee_user_id,source,payroll_item_id)
  VALUES(v_branch,NEW.final_net,'Salary - '||COALESCE(v_name,'Staff')||' - '||v_start::text||' to '||v_end::text,COALESCE(NEW.payment_date,(now() AT TIME ZONE 'Asia/Kolkata')::date),'approved',auth.uid(),auth.uid(),now(),NEW.payment_method::public.payment_method,NULLIF(trim(NEW.payment_reference),''),COALESCE(NEW.payment_date,(now() AT TIME ZONE 'Asia/Kolkata')::date),auth.uid(),true,NEW.user_id,'payroll',NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.payroll_record_salary_expense() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_record_salary_expense() TO service_role;
CREATE TRIGGER payroll_salary_expense AFTER UPDATE OF status ON public.payroll_items FOR EACH ROW EXECUTE FUNCTION public.payroll_record_salary_expense();

DO $patch$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.payroll_settle_item(uuid,uuid[],numeric,text,text,text)'::regprocedure) INTO v;
 IF position('IF v_item.status<>''processed''' IN v)=0 THEN RAISE EXCEPTION 'Expected salary settlement guard missing'; END IF;
 v:=replace(v,'IF v_item.status<>''processed''', 'IF p_method IS DISTINCT FROM v_item.payment_method THEN RAISE EXCEPTION ''Use the payment method saved for remittance''; END IF;
 IF p_method<>''cash'' AND COALESCE(trim(p_reference),'''')='''' THEN RAISE EXCEPTION ''UTR / payment reference is required''; END IF;
 IF v_item.payment_date IS NOT NULL AND v_item.payment_date>(now() AT TIME ZONE ''Asia/Kolkata'')::date THEN RAISE EXCEPTION ''Payment date cannot be in the future''; END IF;
 IF v_item.status<>''processed''');
 v:=replace(v,'adjustment_reason = COALESCE(NULLIF(trim(p_reason),''''), adjustment_reason),','adjustment_reason = v_item.adjustment_reason,');
 EXECUTE v;
END $patch$;

CREATE OR REPLACE FUNCTION public.payroll_record_payment(p_item_id uuid,p_method text,p_reference text,p_payment_date date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.payroll_items%ROWTYPE; v_expense uuid; result jsonb;
BEGIN
 SELECT * INTO i FROM public.payroll_items WHERE id=p_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary not found'; END IF;
 IF public.rpc_guard_applies('payroll_record_payment') AND NOT public._gate_is_owner_admin() THEN RAISE EXCEPTION 'Only owners/admins record salary payments' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('cash','bank_transfer','upi','cheque') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
 IF p_payment_date IS NULL OR p_payment_date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Choose a payment date no later than today'; END IF;
 IF p_method<>'cash' AND COALESCE(trim(p_reference),'')='' THEN RAISE EXCEPTION 'UTR / payment reference is required'; END IF;
 IF i.status='paid' THEN
  SELECT id INTO v_expense FROM public.expenses WHERE payroll_item_id=i.id;
  IF i.payment_method IS NOT DISTINCT FROM p_method AND COALESCE(trim(i.payment_reference),'')=COALESCE(trim(p_reference),'') AND i.payment_date IS NOT DISTINCT FROM p_payment_date AND v_expense IS NOT NULL THEN
   RETURN jsonb_build_object('success',true,'already_recorded',true,'expense_id',v_expense,'net',i.final_net);
  END IF;
  RAISE EXCEPTION 'Salary already paid; recorded payments cannot be changed';
 END IF;
 IF i.status<>'processed' THEN RAISE EXCEPTION 'Preview and save salary before recording payment'; END IF;
 IF p_method IS DISTINCT FROM i.payment_method THEN RAISE EXCEPTION 'Use the payment method saved for remittance'; END IF;
 UPDATE public.payroll_items SET payment_date=p_payment_date WHERE id=i.id;
 result:=public.payroll_settle_item(i.id,COALESCE(i.prepared_installment_ids,'{}'),0,'Remittance confirmed',p_method,NULLIF(trim(p_reference),''));
 SELECT id INTO v_expense FROM public.expenses WHERE payroll_item_id=i.id;
 IF v_expense IS NULL THEN RAISE EXCEPTION 'Salary expense was not recorded'; END IF;
 RETURN result||jsonb_build_object('success',true,'expense_id',v_expense);
END $$;
REVOKE ALL ON FUNCTION public.payroll_record_payment(uuid,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_record_payment(uuid,text,text,date) TO authenticated,service_role;