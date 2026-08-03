CREATE OR REPLACE FUNCTION public.compute_payroll(p_user_id uuid, p_period_start date, p_period_end date, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(work_date date, status text, hours_worked numeric, ot_hours numeric, is_late boolean, is_early_out boolean, is_missing_checkout boolean, is_half_day boolean, is_holiday boolean, is_weekly_off boolean, leave_type text, payable boolean, notes text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_d date;
  v_dow int;
  v_rec RECORD;
  v_ovr RECORD;
  v_src RECORD;
  v_shift_start time; v_shift_end time;
  v_grace int;
  v_half_th numeric;
  v_ot_th numeric;
  v_branch uuid;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_total_seconds numeric;
  v_hours numeric;
  v_status text;
  v_late boolean; v_early boolean; v_missing boolean; v_half boolean;
  v_ot numeric; v_holiday boolean; v_weekly_off boolean;
  v_leave text; v_payable boolean; v_notes text;
  v_holiday_mult numeric;
BEGIN
  SELECT ss.branch_id INTO v_branch FROM public.staff_shifts ss
   WHERE ss.user_id = p_user_id AND ss.branch_id IS NOT NULL LIMIT 1;

  v_d := p_period_start;
  WHILE v_d <= p_period_end LOOP
    v_dow := EXTRACT(DOW FROM v_d);
    v_late := false; v_early := false; v_missing := false; v_half := false;
    v_ot := 0; v_holiday := false; v_weekly_off := false;
    v_leave := NULL; v_payable := true; v_notes := NULL; v_hours := 0;
    v_holiday_mult := 1.0;

    SELECT * INTO v_rec FROM public.staff_shifts ss
      WHERE ss.user_id = p_user_id AND ss.weekday = v_dow LIMIT 1;
    SELECT * INTO v_ovr FROM public.staff_shift_overrides so
      WHERE so.user_id = p_user_id AND so.date = v_d LIMIT 1;

    -- thresholds always come from the recurring roster row (overrides only carry times)
    v_grace   := COALESCE(v_rec.late_grace_min, 15);
    v_half_th := COALESCE(v_rec.half_day_threshold_hours, 4);
    v_ot_th   := COALESCE(v_rec.ot_threshold_hours, 8.5);

    IF v_ovr.user_id IS NOT NULL THEN
      v_src := v_ovr;
    ELSE
      v_src := v_rec;
    END IF;

    IF v_src.user_id IS NOT NULL THEN
      v_shift_start := COALESCE(v_src.morning_start, v_src.evening_start, v_rec.start_time);
      v_shift_end   := COALESCE(v_src.evening_end, v_src.morning_end, v_rec.end_time);
      v_weekly_off  := COALESCE(v_src.is_weekly_off, false)
                       OR (v_src.morning_start IS NULL AND v_src.evening_start IS NULL
                           AND COALESCE(v_rec.start_time, NULL) IS NULL);
    ELSE
      v_shift_start := NULL;
      v_shift_end := NULL;
      v_weekly_off := (v_dow = 0);
    END IF;

    SELECT true, COALESCE(h.pay_multiplier,1.0) INTO v_holiday, v_holiday_mult
      FROM public.holidays h WHERE h.holiday_date = v_d
        AND (h.branch_id IS NULL OR h.branch_id = v_branch)
      LIMIT 1;
    v_holiday := COALESCE(v_holiday, false);

    SELECT lr.leave_type INTO v_leave FROM public.leave_requests lr
      WHERE lr.user_id = p_user_id AND lr.status='approved' AND v_d BETWEEN lr.start_date AND lr.end_date LIMIT 1;

    -- IST-aware day bucketing; prefer the server-stamped shift_date when present
    SELECT MIN(sa.check_in), MAX(COALESCE(sa.check_out, sa.check_in)),
           COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(sa.check_out, sa.check_in) - sa.check_in))), 0)
      INTO v_first_in, v_last_out, v_total_seconds
      FROM public.staff_attendance sa
     WHERE sa.user_id = p_user_id
       AND COALESCE(sa.shift_date, (sa.check_in AT TIME ZONE 'Asia/Kolkata')::date) = v_d;

    IF v_first_in IS NOT NULL THEN
      v_hours := round(LEAST(v_total_seconds/3600.0, 24), 2);
      IF v_last_out IS NULL OR v_last_out = v_first_in THEN
        v_missing := true;
        v_notes := 'missing_checkout';
      END IF;
      IF v_shift_start IS NOT NULL
         AND EXTRACT(EPOCH FROM ((v_first_in AT TIME ZONE 'Asia/Kolkata')::time - v_shift_start))/60.0 > v_grace THEN
        v_late := true;
      END IF;
      IF NOT v_missing AND v_shift_end IS NOT NULL
         AND (v_last_out AT TIME ZONE 'Asia/Kolkata')::time < v_shift_end THEN
        v_early := true;
      END IF;
      IF NOT v_missing AND v_hours < v_half_th THEN v_half := true; END IF;
      IF v_hours > v_ot_th THEN v_ot := round(v_hours - v_ot_th, 2); END IF;

      v_status := CASE
        WHEN v_missing THEN 'present_missing_out'
        WHEN v_half THEN 'half_day'
        ELSE 'present'
      END;

      IF v_holiday AND v_holiday_mult > 1 THEN
        v_notes := COALESCE(v_notes||'; ','') || format('holiday_pay_x%s', v_holiday_mult);
      END IF;

    ELSIF v_holiday THEN
      v_status := 'holiday'; v_payable := true; v_notes := 'paid_holiday';
    ELSIF v_weekly_off THEN
      v_status := 'weekly_off'; v_payable := true;
    ELSIF v_leave IS NOT NULL THEN
      v_status := 'leave';
      v_payable := (v_leave IN ('paid','sick','earned','comp_off'));
      v_notes := v_leave;
    ELSIF v_d > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      v_status := 'scheduled'; v_payable := false; v_notes := 'future_date';
    ELSE
      v_status := 'absent'; v_payable := false;
    END IF;

    work_date := v_d; status := v_status; hours_worked := v_hours; ot_hours := v_ot;
    is_late := v_late; is_early_out := v_early; is_missing_checkout := v_missing;
    is_half_day := v_half; is_holiday := v_holiday; is_weekly_off := v_weekly_off;
    leave_type := v_leave; payable := v_payable; notes := v_notes;
    RETURN NEXT;

    IF p_run_id IS NOT NULL THEN
      INSERT INTO public.payroll_run_lines (
        run_id, user_id, work_date, status, hours_worked, ot_hours,
        is_late, is_early_out, is_missing_checkout, is_half_day,
        is_holiday, is_weekly_off, leave_type, payable, notes
      ) VALUES (
        p_run_id, p_user_id, v_d, v_status, v_hours, v_ot,
        v_late, v_early, v_missing, v_half, v_holiday, v_weekly_off,
        v_leave, v_payable, v_notes
      );
    END IF;

    v_d := v_d + 1;
  END LOOP;
END;
$function$;