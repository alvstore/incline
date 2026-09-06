-- 1. HR settings: TDS rate + advance recovery cap
ALTER TABLE public.hr_settings
  ADD COLUMN IF NOT EXISTS tds_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_recovery_max_per_month numeric;

-- 2. Payroll items: deduction breakdown
ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS calc_deduction_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. compute_payroll: block-accurate fraction + honest weekly-off / unrostered detection
CREATE OR REPLACE FUNCTION public.compute_payroll(p_user_id uuid, p_period_start date, p_period_end date, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(work_date date, status text, hours_worked numeric, ot_hours numeric, is_late boolean, is_early_out boolean, is_missing_checkout boolean, is_half_day boolean, is_holiday boolean, is_weekly_off boolean, leave_type text, payable boolean, notes text, payable_fraction numeric, blocks_rostered integer, blocks_attended integer, hours_source text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_d date;
  v_rec RECORD;
  v_blk RECORD;
  v_grace int; v_ot_th numeric;
  v_branch uuid;
  v_rostered int; v_attended int; v_leave_blocks int;
  v_hours numeric; v_ot numeric;
  v_late boolean; v_missing boolean; v_holiday boolean; v_weekly_off boolean;
  v_leave text; v_payable boolean; v_frac numeric; v_status text; v_notes text;
  v_hsrc text; v_any_rostered_src boolean; v_missed_list text;
  v_holiday_mult numeric;
  v_has_roster boolean;
  v_day_is_off boolean;
BEGIN
  SELECT ss.branch_id INTO v_branch FROM public.staff_shifts ss
   WHERE ss.user_id = p_user_id AND ss.branch_id IS NOT NULL LIMIT 1;

  SELECT EXISTS (SELECT 1 FROM public.staff_shifts ss WHERE ss.user_id = p_user_id)
    INTO v_has_roster;

  v_d := p_period_start;
  WHILE v_d <= p_period_end LOOP
    v_rostered := 0; v_attended := 0; v_leave_blocks := 0;
    v_hours := 0; v_ot := 0; v_late := false; v_missing := false;
    v_holiday := false; v_weekly_off := false; v_leave := NULL;
    v_notes := NULL; v_hsrc := NULL; v_any_rostered_src := false;
    v_missed_list := NULL; v_holiday_mult := 1.0;

    v_rec := NULL;
    SELECT * INTO v_rec FROM public.staff_shifts ss
      WHERE ss.user_id = p_user_id AND ss.weekday = EXTRACT(DOW FROM v_d)::int LIMIT 1;
    v_grace := COALESCE(v_rec.late_grace_min, 15);
    v_ot_th := COALESCE(v_rec.ot_threshold_hours, 8.5);

    -- The roster expresses an off day either by an explicit flag or by having
    -- no row for that weekday. Staff with no roster at all keep the legacy
    -- behaviour (non-working days are treated as weekly off).
    v_day_is_off := (NOT v_has_roster)
                 OR (v_rec IS NULL)
                 OR COALESCE(v_rec.is_weekly_off, false);

    SELECT true, COALESCE(h.pay_multiplier,1.0) INTO v_holiday, v_holiday_mult
      FROM public.holidays h WHERE h.holiday_date = v_d
        AND (h.branch_id IS NULL OR h.branch_id = v_branch) LIMIT 1;
    v_holiday := COALESCE(v_holiday, false);

    SELECT lr.leave_type INTO v_leave FROM public.leave_requests lr
      WHERE lr.user_id = p_user_id AND lr.status = 'approved'
        AND v_d BETWEEN lr.start_date AND lr.end_date LIMIT 1;

    FOR v_blk IN SELECT * FROM public.staff_day_blocks(p_user_id, v_d) LOOP
      IF v_blk.rostered THEN v_rostered := v_rostered + 1; END IF;
      IF v_blk.state = 'attended' THEN
        v_attended := v_attended + 1;
        v_hours := v_hours + COALESCE(v_blk.hours, 0);
        IF v_blk.is_late THEN v_late := true; END IF;
        IF v_blk.hours_source = 'rostered' THEN v_any_rostered_src := true; END IF;
        IF v_blk.hours_source = 'none' THEN v_missing := true; END IF;
      ELSIF v_blk.state = 'leave' THEN
        v_leave_blocks := v_leave_blocks + 1;
      ELSIF v_blk.state IN ('missed','absent') THEN
        v_missed_list := COALESCE(v_missed_list || ', ', '') || v_blk.shift_type || ' missed';
      END IF;
    END LOOP;

    v_hours := round(LEAST(v_hours, 24), 2);
    v_weekly_off := (v_rostered = 0 AND v_attended = 0 AND v_day_is_off);

    -- payable fraction: attended blocks over rostered blocks (leave blocks are excluded
    -- from the denominator and paid separately by leave policy)
    IF v_rostered - v_leave_blocks > 0 THEN
      v_frac := round(LEAST(v_attended::numeric / (v_rostered - v_leave_blocks)::numeric, 1), 2);
    ELSIF v_attended > 0 THEN
      v_frac := 1;
    ELSE
      v_frac := 0;
    END IF;

    IF v_attended > 0 THEN
      IF v_frac >= 1 THEN
        v_status := 'present'; v_payable := true;
      ELSE
        -- block-accurate part day: 1 of 2 = 0.50, 2 of 3 = 0.67
        v_status := 'half_day'; v_payable := true;
      END IF;
      IF v_hours > v_ot_th THEN v_ot := round(v_hours - v_ot_th, 2); END IF;
      v_notes := v_missed_list;
      IF v_any_rostered_src THEN
        v_notes := COALESCE(v_notes || '; ', '') || 'hours_from_roster';
      END IF;
      IF v_holiday AND v_holiday_mult > 1 THEN
        v_notes := COALESCE(v_notes || '; ', '') || format('holiday_pay_x%s', v_holiday_mult);
      END IF;
      v_hsrc := CASE WHEN v_any_rostered_src THEN 'rostered' ELSE 'actual' END;
    ELSIF v_holiday THEN
      v_status := 'holiday'; v_payable := true; v_frac := 1; v_notes := 'paid_holiday';
    ELSIF v_leave IS NOT NULL OR v_leave_blocks > 0 THEN
      v_status := 'leave';
      v_leave := COALESCE(v_leave, 'marked_leave');
      v_payable := (v_leave IN ('paid','sick','earned','comp_off'));
      v_frac := CASE WHEN v_payable THEN 1 ELSE 0 END;
      v_notes := v_leave;
    ELSIF v_weekly_off THEN
      v_status := 'weekly_off'; v_payable := true; v_frac := 1;
    ELSIF v_d > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      v_status := 'scheduled'; v_payable := false; v_frac := 0; v_notes := 'future_date';
    ELSIF v_rostered = 0 THEN
      -- roster says this is a working day but no shift blocks resolved and nobody
      -- punched: a data gap for HR to fix, never silently paid.
      v_status := 'unrostered'; v_payable := false; v_frac := 0;
      v_notes := 'working_day_without_roster_blocks_or_punch';
    ELSE
      v_status := 'absent'; v_payable := false; v_frac := 0; v_notes := v_missed_list;
    END IF;

    work_date := v_d; status := v_status; hours_worked := v_hours; ot_hours := v_ot;
    is_late := v_late; is_early_out := false; is_missing_checkout := v_missing;
    is_half_day := (v_status = 'half_day'); is_holiday := v_holiday;
    is_weekly_off := v_weekly_off; leave_type := v_leave; payable := v_payable;
    notes := v_notes; payable_fraction := v_frac;
    blocks_rostered := v_rostered; blocks_attended := v_attended;
    hours_source := v_hsrc;
    RETURN NEXT;

    IF p_run_id IS NOT NULL THEN
      INSERT INTO public.payroll_run_lines (
        run_id, user_id, work_date, status, hours_worked, ot_hours,
        is_late, is_early_out, is_missing_checkout, is_half_day,
        is_holiday, is_weekly_off, leave_type, payable, notes,
        payable_fraction, blocks_rostered, blocks_attended, hours_source
      ) VALUES (
        p_run_id, p_user_id, v_d, v_status, v_hours, v_ot,
        v_late, false, v_missing, (v_status = 'half_day'),
        v_holiday, v_weekly_off, v_leave, v_payable, v_notes,
        v_frac, v_rostered, v_attended, v_hsrc
      );
    END IF;

    v_d := v_d + 1;
  END LOOP;
END;
$function$;

-- 4. payroll_summarize: pay by real fraction, expose data-gap days
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
    COUNT(*)
  INTO v_present, v_half, v_late, v_missing, v_leave, v_holiday, v_weekly_off, v_absent,
       v_unrostered, v_ot, v_payable_days, v_total_days
  FROM public.compute_payroll(p_user_id, p_period_start, p_period_end, NULL) cp;

  base := CASE WHEN v_total_days > 0 THEN round((v_monthly_salary * v_payable_days / v_total_days)::numeric, 2) ELSE 0 END;
  ot_hours := v_ot;
  attendance := jsonb_build_object(
    'present', v_present, 'half_day', v_half, 'late', v_late,
    'missing_checkout', v_missing, 'leave', v_leave, 'holiday', v_holiday,
    'weekly_off', v_weekly_off, 'absent', v_absent, 'unrostered', v_unrostered,
    'payable_days', v_payable_days, 'total_days', v_total_days,
    'monthly_salary', v_monthly_salary
  );
  RETURN NEXT;
END;
$function$;

-- 5. Statutory deductions helper — everything off unless explicitly enabled
CREATE OR REPLACE FUNCTION public.payroll_statutory_deductions(p_branch_id uuid, p_gross numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.hr_settings%ROWTYPE;
  v_pf numeric := 0; v_esi numeric := 0; v_pt numeric := 0; v_tds numeric := 0;
  v_gross numeric := GREATEST(COALESCE(p_gross, 0), 0);
BEGIN
  IF p_branch_id IS NOT NULL THEN
    SELECT * INTO s FROM public.hr_settings WHERE branch_id = p_branch_id LIMIT 1;
  END IF;
  IF s.id IS NULL THEN
    SELECT * INTO s FROM public.hr_settings WHERE branch_id IS NULL LIMIT 1;
  END IF;
  IF s.id IS NULL THEN
    RETURN jsonb_build_object('pf',0,'esi',0,'professional_tax',0,'tds',0,'total',0);
  END IF;

  IF COALESCE(s.pf_enabled,false) THEN
    v_pf := round(COALESCE(s.pf_employee_pct,0)/100.0
                  * LEAST(v_gross, COALESCE(s.pf_wage_ceiling, v_gross)), 2);
  END IF;

  IF COALESCE(s.esi_enabled,false) AND v_gross <= 21000 THEN
    v_esi := round(COALESCE(s.esi_employee_pct,0)/100.0 * v_gross, 2);
  END IF;

  IF COALESCE(s.pt_enabled,false) AND v_gross > 0 THEN
    v_pt := COALESCE(s.pt_amount,0);
  END IF;

  IF COALESCE(s.tds_enabled,false) THEN
    v_tds := round(COALESCE(s.tds_pct,0)/100.0 * v_gross, 2);
  END IF;

  RETURN jsonb_build_object(
    'pf', v_pf, 'esi', v_esi, 'professional_tax', v_pt, 'tds', v_tds,
    'total', round(v_pf + v_esi + v_pt + v_tds, 2)
  );
END;
$function$;

-- 6. Advance recovery due this run
CREATE OR REPLACE FUNCTION public.payroll_advance_due(p_user_id uuid, p_branch_id uuid, p_payable numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_outstanding numeric := 0;
  v_cap numeric;
BEGIN
  SELECT COALESCE(SUM(GREATEST(COALESCE(sa.outstanding, 0), 0)), 0)
    INTO v_outstanding
    FROM public.salary_advances sa
   WHERE sa.user_id = p_user_id
     AND COALESCE(sa.auto_recover, true) = true
     AND COALESCE(sa.status, 'outstanding') NOT IN ('recovered','cancelled','settled')
     AND COALESCE(sa.outstanding, 0) > 0;

  IF v_outstanding <= 0 THEN RETURN 0; END IF;

  SELECT advance_recovery_max_per_month INTO v_cap
    FROM public.hr_settings
   WHERE (p_branch_id IS NOT NULL AND branch_id = p_branch_id)
   LIMIT 1;
  IF v_cap IS NULL THEN
    SELECT advance_recovery_max_per_month INTO v_cap
      FROM public.hr_settings WHERE branch_id IS NULL LIMIT 1;
  END IF;

  IF v_cap IS NOT NULL AND v_cap > 0 THEN
    v_outstanding := LEAST(v_outstanding, v_cap);
  END IF;

  RETURN round(LEAST(v_outstanding, GREATEST(COALESCE(p_payable,0), 0)), 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.payroll_statutory_deductions(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_advance_due(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_statutory_deductions(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payroll_advance_due(uuid, uuid, numeric) TO authenticated, service_role;

-- 7. Run creation now fills deductions + advance recovery
CREATE OR REPLACE FUNCTION public.payroll_create_run(p_branch_id uuid, p_period_start date, p_period_end date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
  v_user record;
  v_summary record;
  v_gross numeric;
  v_pt numeric;
  v_ded jsonb;
  v_ded_total numeric;
  v_advance numeric;
  v_net numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  INSERT INTO public.payroll_runs (branch_id, period_start, period_end, status, created_by)
  VALUES (p_branch_id, p_period_start, p_period_end, 'calculated', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_user IN
    SELECT DISTINCT u.user_id, u.kind FROM (
      SELECT user_id, 'employee'::text AS kind FROM public.employees
        WHERE user_id IS NOT NULL
          AND COALESCE(is_active, true) = true
          AND exit_date IS NULL
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
      UNION
      SELECT user_id, 'trainer'::text AS kind FROM public.trainers
        WHERE user_id IS NOT NULL
          AND COALESCE(is_active, true) = true
          AND exit_date IS NULL
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    ) u
  LOOP
    SELECT * INTO v_summary FROM public.payroll_summarize(v_user.user_id, p_period_start, p_period_end);
    v_pt := public.pt_commission_due_for_period(v_user.user_id, p_period_start, p_period_end);
    v_gross := COALESCE(v_summary.base,0) + COALESCE(v_pt,0);

    v_ded := public.payroll_statutory_deductions(p_branch_id, v_gross);
    v_ded_total := COALESCE((v_ded->>'total')::numeric, 0);
    v_advance := public.payroll_advance_due(v_user.user_id, p_branch_id, v_gross - v_ded_total);
    v_net := round(GREATEST(v_gross - v_ded_total - v_advance, 0), 2);

    INSERT INTO public.payroll_items (
      run_id, user_id, staff_kind,
      calc_base, calc_pt_commission, calc_ot, calc_deductions, calc_gross, calc_net,
      calc_attendance, calc_deduction_breakdown,
      final_base, final_pt_commission, final_ot, final_deductions, final_advance, final_gross, final_net
    ) VALUES (
      v_run_id, v_user.user_id, v_user.kind,
      v_summary.base, COALESCE(v_pt,0), v_summary.ot_hours, v_ded_total, v_gross, v_net,
      v_summary.attendance, v_ded || jsonb_build_object('advance', v_advance),
      v_summary.base, COALESCE(v_pt,0), v_summary.ot_hours, v_ded_total, v_advance, v_gross, v_net
    )
    ON CONFLICT (run_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.payroll_audit (run_id, actor_id, action, after_data)
  VALUES (v_run_id, auth.uid(), 'run_created',
          jsonb_build_object('branch_id', p_branch_id, 'period_start', p_period_start, 'period_end', p_period_end));

  RETURN v_run_id;
END;
$function$;

-- 8. Recalculation keeps deductions and advance in step
CREATE OR REPLACE FUNCTION public.payroll_recalculate_item(p_item_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.payroll_items%ROWTYPE;
  v_run public.payroll_runs%ROWTYPE;
  v_sum RECORD;
  v_pt numeric;
  v_gross numeric;
  v_ded jsonb;
  v_ded_total numeric;
  v_advance numeric;
  v_net numeric;
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

  v_ded := public.payroll_statutory_deductions(v_run.branch_id, v_gross);
  v_ded_total := COALESCE((v_ded->>'total')::numeric, 0);
  v_advance := public.payroll_advance_due(v_item.user_id, v_run.branch_id, v_gross - v_ded_total);
  v_net := round(GREATEST(v_gross - v_ded_total - v_advance, 0), 2);

  v_adjusted := (v_item.final_net IS DISTINCT FROM v_item.calc_net)
             OR COALESCE((v_item.calc_attendance->>'manual_full_present')::boolean, false);

  v_before := to_jsonb(v_item);

  UPDATE public.payroll_items
     SET calc_base = v_sum.base,
         calc_pt_commission = COALESCE(v_pt,0),
         calc_ot = v_sum.ot_hours,
         calc_deductions = v_ded_total,
         calc_gross = v_gross,
         calc_net = v_net,
         calc_attendance = v_sum.attendance,
         calc_deduction_breakdown = v_ded || jsonb_build_object('advance', v_advance),
         final_base = CASE WHEN v_adjusted THEN final_base ELSE v_sum.base END,
         final_pt_commission = CASE WHEN v_adjusted THEN final_pt_commission ELSE COALESCE(v_pt,0) END,
         final_ot = CASE WHEN v_adjusted THEN final_ot ELSE v_sum.ot_hours END,
         final_deductions = CASE WHEN v_adjusted THEN final_deductions ELSE v_ded_total END,
         final_advance = CASE WHEN v_adjusted THEN final_advance ELSE v_advance END,
         final_gross = CASE WHEN v_adjusted THEN final_gross ELSE v_gross END,
         final_net = CASE WHEN v_adjusted THEN final_net ELSE v_net END,
         attendance_changed_at = NULL,
         updated_at = now()
   WHERE id = p_item_id;

  SELECT to_jsonb(pi) INTO v_after FROM public.payroll_items pi WHERE id = p_item_id;

  INSERT INTO public.payroll_audit (run_id, item_id, actor_id, action, before_data, after_data, reason)
  VALUES (v_item.run_id, p_item_id, auth.uid(), 'recalculate_item', v_before, v_after,
          COALESCE(NULLIF(p_reason,''), 'attendance changed'));
END;
$function$;