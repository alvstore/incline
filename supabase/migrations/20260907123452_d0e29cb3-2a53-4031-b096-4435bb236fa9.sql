-- 1) Payroll: exclude owners/admins, one row per person (trainer wins)
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
    SELECT DISTINCT ON (u.user_id) u.user_id, u.kind
    FROM (
      SELECT user_id, 'employee'::text AS kind, 2 AS pref FROM public.employees
        WHERE user_id IS NOT NULL
          AND COALESCE(is_active, true) = true
          AND exit_date IS NULL
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
      UNION ALL
      SELECT user_id, 'trainer'::text AS kind, 1 AS pref FROM public.trainers
        WHERE user_id IS NOT NULL
          AND COALESCE(is_active, true) = true
          AND exit_date IS NULL
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    ) u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.user_id AND ur.role IN ('owner','admin')
    )
    ORDER BY u.user_id, u.pref
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

-- 2) Backfill real names into the gate face ledger
UPDATE public.mips_device_face_state f
SET person_name = COALESCE(pr.full_name, l.full_name, f.person_name)
FROM public.members m
LEFT JOIN public.profiles pr ON pr.id = m.user_id
LEFT JOIN public.leads l ON l.id = m.lead_id
WHERE f.person_type = 'member'
  AND m.mips_person_sn IS NOT NULL
  AND f.person_sn = m.mips_person_sn
  AND COALESCE(pr.full_name, l.full_name) IS NOT NULL;

UPDATE public.mips_device_face_state f
SET person_name = pr.full_name
FROM public.employees e
JOIN public.profiles pr ON pr.id = e.user_id
WHERE f.person_type = 'employee'
  AND e.mips_person_sn IS NOT NULL
  AND f.person_sn = e.mips_person_sn
  AND pr.full_name IS NOT NULL;

UPDATE public.mips_device_face_state f
SET person_name = pr.full_name
FROM public.trainers t
JOIN public.profiles pr ON pr.id = t.user_id
WHERE f.person_type = 'trainer'
  AND t.mips_person_sn IS NOT NULL
  AND f.person_sn = t.mips_person_sn
  AND pr.full_name IS NOT NULL;