CREATE OR REPLACE FUNCTION public.payroll_summarize(p_user_id uuid, p_period_start date, p_period_end date)
 RETURNS TABLE(base numeric, ot_hours numeric, attendance jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $function$
DECLARE
  v_present int := 0; v_half int := 0; v_late int := 0; v_missing int := 0;
  v_leave int := 0; v_holiday int := 0; v_weekly_off int := 0; v_absent int := 0;
  v_ot numeric := 0; v_payable_days numeric := 0; v_total_days int := 0;
  v_monthly_salary numeric := 0;
BEGIN
  SELECT COALESCE(salary, 0) INTO v_monthly_salary
    FROM public.employees WHERE user_id = p_user_id LIMIT 1;
  IF v_monthly_salary IS NULL OR v_monthly_salary = 0 THEN
    SELECT COALESCE(fixed_salary, 0) INTO v_monthly_salary
      FROM public.trainers WHERE user_id = p_user_id LIMIT 1;
  END IF;
  v_monthly_salary := COALESCE(v_monthly_salary, 0);

  SELECT
    COUNT(*) FILTER (WHERE cp.status='present'),
    COUNT(*) FILTER (WHERE cp.is_half_day),
    COUNT(*) FILTER (WHERE cp.is_late),
    COUNT(*) FILTER (WHERE cp.is_missing_checkout),
    COUNT(*) FILTER (WHERE cp.status='leave'),
    COUNT(*) FILTER (WHERE cp.is_holiday),
    COUNT(*) FILTER (WHERE cp.is_weekly_off),
    COUNT(*) FILTER (WHERE cp.status='absent'),
    COALESCE(SUM(cp.ot_hours),0),
    COALESCE(SUM(CASE WHEN cp.payable THEN (CASE WHEN cp.is_half_day THEN 0.5 ELSE 1 END) ELSE 0 END),0),
    COUNT(*)
  INTO v_present, v_half, v_late, v_missing, v_leave, v_holiday, v_weekly_off, v_absent, v_ot, v_payable_days, v_total_days
  FROM public.compute_payroll(p_user_id, p_period_start, p_period_end, NULL) cp;

  base := CASE WHEN v_total_days > 0 THEN round((v_monthly_salary * v_payable_days / v_total_days)::numeric, 2) ELSE 0 END;
  ot_hours := v_ot;
  attendance := jsonb_build_object(
    'present', v_present, 'half_day', v_half, 'late', v_late,
    'missing_checkout', v_missing, 'leave', v_leave, 'holiday', v_holiday,
    'weekly_off', v_weekly_off, 'absent', v_absent,
    'payable_days', v_payable_days, 'total_days', v_total_days,
    'monthly_salary', v_monthly_salary
  );
  RETURN NEXT;
END;
$function$;