CREATE OR REPLACE FUNCTION public.payroll_create_run(p_branch_id uuid, p_period_start date, p_period_end date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid; v_user record; v_summary record;
  v_gross numeric; v_pt numeric; v_ded jsonb; v_ded_total numeric; v_advance numeric; v_net numeric;
  v_mult numeric; v_days int; v_monthly numeric; v_hourly numeric; v_rate numeric; v_ot_pay numeric; v_att jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT COALESCE(ot_multiplier, 2.0) INTO v_mult FROM public.hr_settings
   WHERE branch_id = p_branch_id OR branch_id IS NULL ORDER BY (branch_id IS NULL) LIMIT 1;
  v_mult := COALESCE(v_mult, 2.0);
  v_days := GREATEST((p_period_end - p_period_start) + 1, 1);

  INSERT INTO public.payroll_runs (branch_id, period_start, period_end, status, created_by)
  VALUES (p_branch_id, p_period_start, p_period_end, 'calculated', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_user IN
    SELECT DISTINCT ON (u.user_id) u.user_id, u.kind
    FROM (
      SELECT user_id, 'employee'::text AS kind, 2 AS pref FROM public.employees
        WHERE user_id IS NOT NULL AND COALESCE(is_active, true) AND exit_date IS NULL
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
      UNION ALL
      SELECT user_id, 'trainer'::text, 1 FROM public.trainers
        WHERE user_id IS NOT NULL AND COALESCE(is_active, true) AND exit_date IS NULL
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    ) u
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.user_id AND ur.role IN ('owner','admin'))
    ORDER BY u.user_id, u.pref
  LOOP
    SELECT * INTO v_summary FROM public.payroll_summarize(v_user.user_id, p_period_start, p_period_end);
    v_pt := public.pt_commission_due_for_period(v_user.user_id, p_period_start, p_period_end);

    v_monthly := NULL; v_hourly := NULL;
    IF v_user.kind = 'trainer' THEN
      SELECT fixed_salary, hourly_rate INTO v_monthly, v_hourly FROM public.trainers WHERE user_id = v_user.user_id LIMIT 1;
    ELSE
      SELECT salary INTO v_monthly FROM public.employees WHERE user_id = v_user.user_id LIMIT 1;
    END IF;
    v_rate := CASE WHEN COALESCE(v_hourly,0) > 0 THEN v_hourly
                   ELSE COALESCE(v_monthly,0) / (v_days * 8.0) END;
    v_ot_pay := round(COALESCE(v_summary.ot_hours,0) * v_rate * v_mult, 2);

    v_gross := COALESCE(v_summary.base,0) + COALESCE(v_pt,0) + v_ot_pay;
    v_ded := public.payroll_statutory_deductions(p_branch_id, v_gross);
    v_ded_total := COALESCE((v_ded->>'total')::numeric, 0);
    v_advance := public.payroll_advance_due(v_user.user_id, p_branch_id, v_gross - v_ded_total);
    v_net := round(GREATEST(v_gross - v_ded_total - v_advance, 0), 2);
    v_att := COALESCE(v_summary.attendance,'{}'::jsonb) || jsonb_build_object(
      'ot_hours', COALESCE(v_summary.ot_hours,0), 'ot_hourly_rate', round(v_rate,2), 'ot_multiplier', v_mult);

    INSERT INTO public.payroll_items (
      run_id, user_id, staff_kind,
      calc_base, calc_pt_commission, calc_ot, calc_deductions, calc_gross, calc_net,
      calc_attendance, calc_deduction_breakdown,
      final_base, final_pt_commission, final_ot, final_deductions, final_advance, final_gross, final_net
    ) VALUES (
      v_run_id, v_user.user_id, v_user.kind,
      v_summary.base, COALESCE(v_pt,0), v_ot_pay, v_ded_total, v_gross, v_net,
      v_att, v_ded || jsonb_build_object('advance', v_advance),
      v_summary.base, COALESCE(v_pt,0), v_ot_pay, v_ded_total, v_advance, v_gross, v_net
    )
    ON CONFLICT (run_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.payroll_audit (run_id, actor_id, action, after_data)
  VALUES (v_run_id, auth.uid(), 'run_created',
          jsonb_build_object('branch_id', p_branch_id, 'period_start', p_period_start, 'period_end', p_period_end, 'ot_multiplier', v_mult));
  RETURN v_run_id;
END;
$function$;