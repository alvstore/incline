-- 1. Self-edit guard function
CREATE OR REPLACE FUNCTION public.block_manager_self_hr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Owner/admin are exempt
  IF has_any_role(v_uid, ARRAY['owner'::app_role, 'admin'::app_role]) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only enforce for managers
  IF NOT has_role(v_uid, 'manager'::app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_target := COALESCE((NEW).user_id, (OLD).user_id);

  IF v_target IS NOT NULL AND v_target = v_uid THEN
    RAISE EXCEPTION 'Managers cannot modify their own HR/payroll record (table %)', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. Attach trigger to HR/payroll tables
DROP TRIGGER IF EXISTS tg_block_manager_self_hr ON public.employees;
CREATE TRIGGER tg_block_manager_self_hr
  BEFORE INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.block_manager_self_hr();

DROP TRIGGER IF EXISTS tg_block_manager_self_hr ON public.contracts;
CREATE TRIGGER tg_block_manager_self_hr
  BEFORE INSERT OR UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.block_manager_self_hr();

DROP TRIGGER IF EXISTS tg_block_manager_self_hr ON public.trainers;
CREATE TRIGGER tg_block_manager_self_hr
  BEFORE INSERT OR UPDATE OR DELETE ON public.trainers
  FOR EACH ROW EXECUTE FUNCTION public.block_manager_self_hr();

DROP TRIGGER IF EXISTS tg_block_manager_self_hr ON public.payroll_items;
CREATE TRIGGER tg_block_manager_self_hr
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.block_manager_self_hr();

-- payroll_run_lines may key by employee_id (not user_id); guard via join
CREATE OR REPLACE FUNCTION public.block_manager_self_payroll_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target_user uuid;
  v_emp_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF has_any_role(v_uid, ARRAY['owner'::app_role, 'admin'::app_role]) THEN RETURN COALESCE(NEW, OLD); END IF;
  IF NOT has_role(v_uid, 'manager'::app_role) THEN RETURN COALESCE(NEW, OLD); END IF;

  v_emp_id := COALESCE((NEW).employee_id, (OLD).employee_id);
  IF v_emp_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT user_id INTO v_target_user FROM public.employees WHERE id = v_emp_id;
  IF v_target_user IS NOT NULL AND v_target_user = v_uid THEN
    RAISE EXCEPTION 'Managers cannot modify their own payroll line' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_block_manager_self_payroll_line ON public.payroll_run_lines;
CREATE TRIGGER tg_block_manager_self_payroll_line
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.block_manager_self_payroll_line();

-- 3. Tighten payroll_runs / payroll_run_lines to manager's visible branches
DROP POLICY IF EXISTS payroll_runs_admin_all ON public.payroll_runs;
CREATE POLICY payroll_runs_owner_admin_all ON public.payroll_runs
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));
CREATE POLICY payroll_runs_manager_branch ON public.payroll_runs
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role)
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

DROP POLICY IF EXISTS payroll_run_lines_admin_all ON public.payroll_run_lines;
CREATE POLICY payroll_run_lines_owner_admin_all ON public.payroll_run_lines
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));
CREATE POLICY payroll_run_lines_manager_branch ON public.payroll_run_lines
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND run_id IN (
      SELECT id FROM public.payroll_runs
      WHERE branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role)
    AND run_id IN (
      SELECT id FROM public.payroll_runs
      WHERE branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  );

-- 4. Drop unused permission tables (0 rows, 0 code refs; superseded by role_capabilities + has_role)
DROP TABLE IF EXISTS public.role_permissions CASCADE;
DROP TABLE IF EXISTS public.permissions CASCADE;