CREATE OR REPLACE FUNCTION public.payroll_recalculate_item(p_item_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item public.payroll_items%ROWTYPE;
  v_run public.payroll_runs%ROWTYPE;
  v_sum RECORD;
  v_pt numeric;
  v_gross numeric;
  v_adjusted boolean;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT * INTO v_item FROM public.payroll_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll item not found'; END IF;

  SELECT * INTO v_run FROM public.payroll_runs WHERE id = v_item.run_id;
  IF v_run.status IN ('processed','paid') OR v_item.status IN ('processed','paid') THEN
    RAISE EXCEPTION 'Payroll already % — recalculation is not allowed', COALESCE(v_item.status, v_run.status);
  END IF;

  SELECT * INTO v_sum FROM public.payroll_summarize(v_item.user_id, v_run.period_start, v_run.period_end);
  v_pt := public.pt_commission_due_for_period(v_item.user_id, v_run.period_start, v_run.period_end);
  v_gross := COALESCE(v_sum.base,0) + COALESCE(v_pt,0);

  -- an already hand-adjusted line keeps its final amounts; only the calculated
  -- reference values refresh so HR can see the new baseline.
  v_adjusted := (v_item.final_net IS DISTINCT FROM v_item.calc_net)
             OR COALESCE((v_item.calc_attendance->>'manual_full_present')::boolean, false);

  v_before := to_jsonb(v_item);

  UPDATE public.payroll_items
     SET calc_base = v_sum.base,
         calc_pt_commission = COALESCE(v_pt,0),
         calc_ot = v_sum.ot_hours,
         calc_gross = v_gross,
         calc_net = v_gross,
         calc_attendance = v_sum.attendance,
         final_base = CASE WHEN v_adjusted THEN final_base ELSE v_sum.base END,
         final_pt_commission = CASE WHEN v_adjusted THEN final_pt_commission ELSE COALESCE(v_pt,0) END,
         final_ot = CASE WHEN v_adjusted THEN final_ot ELSE v_sum.ot_hours END,
         final_gross = CASE WHEN v_adjusted THEN final_gross ELSE v_gross END,
         final_net = CASE WHEN v_adjusted THEN final_net ELSE v_gross END,
         attendance_changed_at = NULL,
         updated_at = now()
   WHERE id = p_item_id;

  SELECT to_jsonb(pi) INTO v_after FROM public.payroll_items pi WHERE id = p_item_id;

  INSERT INTO public.payroll_audit (run_id, item_id, actor_id, action, before_data, after_data, reason)
  VALUES (v_item.run_id, p_item_id, auth.uid(), 'recalculate_item', v_before, v_after,
          COALESCE(NULLIF(p_reason,''), 'attendance changed'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_recalculate_item(uuid, text) TO authenticated;