CREATE OR REPLACE FUNCTION public.payroll_summarize(p_user_id uuid, p_period_start date, p_period_end date)
 RETURNS TABLE(base numeric, ot_hours numeric, attendance jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_present int := 0; v_half int := 0; v_late int := 0; v_missing int := 0;
  v_leave int := 0; v_holiday int := 0; v_weekly_off int := 0; v_absent int := 0;
  v_unrostered int := 0;
  v_ot numeric := 0; v_payable_days numeric := 0; v_total_days int := 0;
  v_monthly_salary numeric := 0;
  v_shifts_rostered int := 0; v_shifts_attended int := 0;
  v_per_shift numeric := 0;
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
    COUNT(*) FILTER (WHERE cp.status='unrostered'),
    COALESCE(SUM(cp.ot_hours),0),
    COALESCE(SUM(CASE WHEN cp.payable THEN COALESCE(cp.payable_fraction, 0) ELSE 0 END),0),
    COUNT(*),
    COALESCE(SUM(COALESCE(cp.blocks_rostered,0)),0),
    COALESCE(SUM(COALESCE(cp.blocks_attended,0)),0)
  INTO v_present, v_half, v_late, v_missing, v_leave, v_holiday, v_weekly_off, v_absent,
       v_unrostered, v_ot, v_payable_days, v_total_days, v_shifts_rostered, v_shifts_attended
  FROM public.compute_payroll(p_user_id, p_period_start, p_period_end, NULL) cp;

  base := CASE WHEN v_total_days > 0 THEN round((v_monthly_salary * v_payable_days / v_total_days)::numeric, 2) ELSE 0 END;
  ot_hours := v_ot;
  v_per_shift := CASE WHEN v_shifts_rostered > 0 THEN round(v_monthly_salary / v_shifts_rostered, 2) ELSE 0 END;

  attendance := jsonb_build_object(
    'present', v_present, 'half_day', v_half, 'late', v_late,
    'missing_checkout', v_missing, 'leave', v_leave, 'holiday', v_holiday,
    'weekly_off', v_weekly_off, 'absent', v_absent, 'unrostered', v_unrostered,
    'payable_days', v_payable_days, 'total_days', v_total_days,
    'monthly_salary', v_monthly_salary,
    'shifts_rostered', v_shifts_rostered,
    'shifts_attended', v_shifts_attended,
    'shifts_missed', GREATEST(v_shifts_rostered - v_shifts_attended, 0),
    'per_shift_rate', v_per_shift
  );
  RETURN NEXT;
END;
$function$;