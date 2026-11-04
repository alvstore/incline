DO $patch$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.payroll_prepare_item(uuid,uuid[],jsonb,text,text,jsonb)'::regprocedure) INTO v;
 IF position('IF i.status IN (''processed'',''paid'')' IN v)=0 THEN RAISE EXCEPTION 'Expected salary preparation guard missing'; END IF;
 v:=replace(v,'IF i.status IN (''processed'',''paid'')','PERFORM pg_advisory_xact_lock(hashtextextended(i.user_id::text||r.period_start::text,0));
 IF EXISTS(SELECT 1 FROM public.payroll_items other JOIN public.payroll_runs other_run ON other_run.id=other.run_id WHERE other.id<>i.id AND other.user_id=i.user_id AND other.status IN (''processed'',''paid'') AND other_run.period_start=r.period_start) THEN RAISE EXCEPTION ''This month already has a saved or paid salary for this staff member; open the original salary''; END IF;
 IF i.status IN (''processed'',''paid'')');
 EXECUTE v;
END $patch$;
CREATE OR REPLACE FUNCTION public.payroll_preserve_paid_salary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status='paid' AND (NEW.status,NEW.user_id,NEW.run_id,NEW.final_base,NEW.final_pt_commission,NEW.final_ot,NEW.final_bonus,NEW.final_deductions,NEW.final_advance,NEW.final_penalty,NEW.final_gross,NEW.final_net,NEW.payment_method,NEW.payment_reference,NEW.payment_date,NEW.prepared_installment_ids,NEW.adjustment_reason) IS DISTINCT FROM (OLD.status,OLD.user_id,OLD.run_id,OLD.final_base,OLD.final_pt_commission,OLD.final_ot,OLD.final_bonus,OLD.final_deductions,OLD.final_advance,OLD.final_penalty,OLD.final_gross,OLD.final_net,OLD.payment_method,OLD.payment_reference,OLD.payment_date,OLD.prepared_installment_ids,OLD.adjustment_reason) THEN
  RAISE EXCEPTION 'Paid salary and remittance are immutable; record corrections separately';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.payroll_preserve_paid_salary() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_preserve_paid_salary() TO service_role;
CREATE TRIGGER payroll_preserve_paid_salary BEFORE UPDATE ON public.payroll_items FOR EACH ROW EXECUTE FUNCTION public.payroll_preserve_paid_salary();