
-- 1) Fix payroll_create_run: employees/trainers use is_active + exit_date, not status
CREATE OR REPLACE FUNCTION public.payroll_create_run(
  p_branch_id uuid, p_period_start date, p_period_end date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id uuid;
  v_user record;
  v_summary record;
  v_gross numeric;
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
    v_gross := COALESCE(v_summary.base,0);

    INSERT INTO public.payroll_items (
      run_id, user_id, staff_kind,
      calc_base, calc_pt_commission, calc_ot, calc_deductions, calc_gross, calc_net, calc_attendance,
      final_base, final_pt_commission, final_ot, final_deductions, final_gross, final_net
    ) VALUES (
      v_run_id, v_user.user_id, v_user.kind,
      v_summary.base, 0, v_summary.ot_hours, 0, v_gross, v_gross, v_summary.attendance,
      v_summary.base, 0, v_summary.ot_hours, 0, v_gross, v_gross
    )
    ON CONFLICT (run_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.payroll_audit (run_id, actor_id, action, after_data)
  VALUES (v_run_id, auth.uid(), 'run_created',
          jsonb_build_object('branch_id', p_branch_id, 'period_start', p_period_start, 'period_end', p_period_end));

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_create_run(uuid,date,date) TO authenticated;

-- 2) Statutory deduction config (all OFF by default)
ALTER TABLE public.hr_settings
  ADD COLUMN IF NOT EXISTS pf_enabled        boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pf_employee_pct   numeric(5,2)  NOT NULL DEFAULT 12.00,
  ADD COLUMN IF NOT EXISTS pf_wage_ceiling   numeric                DEFAULT 15000,
  ADD COLUMN IF NOT EXISTS esi_enabled       boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esi_employee_pct  numeric(5,2)  NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS pt_enabled        boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pt_amount         numeric                DEFAULT 200,
  ADD COLUMN IF NOT EXISTS tds_enabled       boolean       NOT NULL DEFAULT false;

-- 3) RPC: process every reviewable item in a run (used by Process All)
CREATE OR REPLACE FUNCTION public.payroll_process_all_for_run(p_run_id uuid)
RETURNS TABLE(processed_count int, skipped_count int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_processed int := 0;
  v_skipped   int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.payroll_items
     SET status = 'approved', updated_at = now()
   WHERE run_id = p_run_id
     AND status IN ('draft','reviewed');

  UPDATE public.payroll_runs
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = p_run_id;

  WITH upd AS (
    UPDATE public.payroll_items
       SET status = 'processed', updated_at = now()
     WHERE run_id = p_run_id AND status = 'approved'
     RETURNING id
  )
  SELECT count(*) INTO v_processed FROM upd;

  SELECT count(*) INTO v_skipped
    FROM public.payroll_items
   WHERE run_id = p_run_id AND status NOT IN ('processed','paid');

  INSERT INTO public.payroll_audit (run_id, actor_id, action, after_data)
  VALUES (p_run_id, auth.uid(), 'run_processed_all',
          jsonb_build_object('processed', v_processed, 'skipped', v_skipped));

  processed_count := v_processed;
  skipped_count   := v_skipped;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_process_all_for_run(uuid) TO authenticated;

-- 4) RPC: mark a staff member full-month present (used when attendance was missed)
CREATE OR REPLACE FUNCTION public.payroll_mark_full_present(
  p_item_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item       public.payroll_items%ROWTYPE;
  v_run        public.payroll_runs%ROWTYPE;
  v_days       int;
  v_base_in    numeric;
  v_new_base   numeric;
  v_before     jsonb;
  v_after      jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT * INTO v_item FROM public.payroll_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;

  SELECT * INTO v_run FROM public.payroll_runs WHERE id = v_item.run_id;
  IF v_run.status IN ('processed','paid') THEN
    RAISE EXCEPTION 'Run already processed; cannot mark present';
  END IF;

  v_days := (v_run.period_end - v_run.period_start) + 1;

  -- Resolve full monthly base salary from employees/trainers
  SELECT COALESCE(e.salary, t.fixed_salary, 0)
    INTO v_base_in
  FROM (SELECT 1) z
  LEFT JOIN public.employees e ON e.user_id = v_item.user_id
  LEFT JOIN public.trainers  t ON t.user_id = v_item.user_id
  LIMIT 1;

  v_new_base := COALESCE(v_base_in, 0);

  v_before := to_jsonb(v_item);
  UPDATE public.payroll_items
     SET final_base = v_new_base,
         final_gross = v_new_base + final_pt_commission + final_ot + final_bonus,
         final_net   = (v_new_base + final_pt_commission + final_ot + final_bonus)
                     - (final_deductions + final_advance + final_penalty),
         adjustment_reason = COALESCE(adjustment_reason || ' | ', '') || ('mark_full_present: ' || p_reason),
         calc_attendance = COALESCE(calc_attendance,'{}'::jsonb)
                          || jsonb_build_object('manual_full_present', true,
                                                'manual_days', v_days,
                                                'marked_by', auth.uid(),
                                                'marked_at', now()),
         status = CASE WHEN status='draft' THEN 'reviewed' ELSE status END,
         updated_at = now()
   WHERE id = p_item_id;

  SELECT to_jsonb(pi) INTO v_after FROM public.payroll_items pi WHERE id = p_item_id;

  INSERT INTO public.payroll_audit (run_id, item_id, actor_id, action, before_data, after_data, reason)
  VALUES (v_item.run_id, p_item_id, auth.uid(), 'mark_full_present', v_before, v_after, p_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_mark_full_present(uuid,text) TO authenticated;
