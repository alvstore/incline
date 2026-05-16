
-- ===== 1. Trainer code auto-generator =====
CREATE OR REPLACE FUNCTION public.generate_trainer_code(p_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_code text;
  v_seq         integer;
  v_code        text;
BEGIN
  SELECT COALESCE(NULLIF(code, ''), 'BR')
    INTO v_branch_code
  FROM branches WHERE id = p_branch_id;

  IF v_branch_code IS NULL THEN
    v_branch_code := 'BR';
  END IF;

  SELECT COUNT(*) + 1 INTO v_seq
  FROM trainers
  WHERE branch_id = p_branch_id;

  v_code := 'TR-' || v_branch_code || '-' || lpad(v_seq::text, 4, '0');

  -- Ensure uniqueness even if races happen
  WHILE EXISTS (SELECT 1 FROM trainers WHERE trainer_code = v_code) LOOP
    v_seq := v_seq + 1;
    v_code := 'TR-' || v_branch_code || '-' || lpad(v_seq::text, 4, '0');
  END LOOP;

  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION public.assign_trainer_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trainer_code IS NULL OR NEW.trainer_code = '' THEN
    NEW.trainer_code := public.generate_trainer_code(NEW.branch_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trainers_assign_code ON public.trainers;
CREATE TRIGGER trainers_assign_code
  BEFORE INSERT ON public.trainers
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_trainer_code();

-- ===== 2. Employee code auto-generator =====
CREATE OR REPLACE FUNCTION public.generate_employee_code(p_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_code text;
  v_seq         integer;
  v_code        text;
BEGIN
  SELECT COALESCE(NULLIF(code, ''), 'BR')
    INTO v_branch_code
  FROM branches WHERE id = p_branch_id;

  IF v_branch_code IS NULL THEN
    v_branch_code := 'BR';
  END IF;

  SELECT COUNT(*) + 1 INTO v_seq
  FROM employees
  WHERE branch_id = p_branch_id;

  v_code := 'EMP-' || v_branch_code || '-' || lpad(v_seq::text, 4, '0');

  WHILE EXISTS (SELECT 1 FROM employees WHERE employee_code = v_code) LOOP
    v_seq := v_seq + 1;
    v_code := 'EMP-' || v_branch_code || '-' || lpad(v_seq::text, 4, '0');
  END LOOP;

  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION public.assign_employee_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.employee_code IS NULL OR NEW.employee_code = '' THEN
    NEW.employee_code := public.generate_employee_code(NEW.branch_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS employees_assign_code ON public.employees;
CREATE TRIGGER employees_assign_code
  BEFORE INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_employee_code();

-- ===== 3. Backfill existing rows =====
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, branch_id FROM trainers WHERE trainer_code IS NULL OR trainer_code = '' LOOP
    UPDATE trainers SET trainer_code = public.generate_trainer_code(r.branch_id) WHERE id = r.id;
  END LOOP;
END $$;

-- Normalize legacy employee codes that used random suffix (EMP-<branch>-<RANDOM6>) — leave as is if already structured, only fill nulls
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, branch_id FROM employees WHERE employee_code IS NULL OR employee_code = '' LOOP
    UPDATE employees SET employee_code = public.generate_employee_code(r.branch_id) WHERE id = r.id;
  END LOOP;
END $$;

-- ===== 4. Seed lead_alert WhatsApp template stub (global, pending) =====
INSERT INTO public.templates (
  branch_id, name, type, content, variables,
  meta_template_name, meta_template_status,
  header_type, attachment_source,
  trigger_event, is_active
)
SELECT
  NULL,
  'Lead Captured Staff Alert',
  'whatsapp',
  E'🔔 New lead alert\n\nName: {{1}}\nPhone: {{2}}\nSource: {{3}}\nBranch: {{4}}\n\nFollow up within 15 minutes for best conversion.',
  '["1","2","3","4"]'::jsonb,
  'lead_alert',
  'pending',
  'none',
  'none',
  'lead_captured_staff_alert',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.templates WHERE meta_template_name = 'lead_alert' AND type = 'whatsapp'
);
