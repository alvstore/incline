-- 1. Extend expenses
DO $$ BEGIN
  CREATE TYPE public.expense_kind AS ENUM ('general','vendor_bill','salary_advance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_type public.expense_kind NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS bill_number text,
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS employee_user_id uuid,
  ADD COLUMN IF NOT EXISTS edit_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON public.expenses(branch_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_employee ON public.expenses(employee_user_id) WHERE employee_user_id IS NOT NULL;

-- 2. Salary advances ledger
CREATE TABLE IF NOT EXISTS public.salary_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  outstanding numeric(10,2) NOT NULL,
  paid_on date NOT NULL DEFAULT CURRENT_DATE,
  payment_method public.payment_method,
  payment_reference text,
  reason text,
  auto_recover boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'outstanding',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_advances TO authenticated;
GRANT ALL ON public.salary_advances TO service_role;

ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salary_advances_owner_admin_all" ON public.salary_advances
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "salary_advances_manager_branch" ON public.salary_advances
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'manager') AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(),'manager') AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())));

CREATE POLICY "salary_advances_read_own" ON public.salary_advances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_salary_advances_user_status ON public.salary_advances(user_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_advances_branch ON public.salary_advances(branch_id, paid_on DESC);

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_salary_advances_touch ON public.salary_advances;
CREATE TRIGGER trg_salary_advances_touch BEFORE UPDATE ON public.salary_advances
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_expenses_touch ON public.expenses;
CREATE TRIGGER trg_expenses_touch BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 3. Atomic record_expense
CREATE OR REPLACE FUNCTION public.record_expense(
  p_branch_id uuid,
  p_amount numeric,
  p_description text,
  p_expense_type public.expense_kind DEFAULT 'general',
  p_category_id uuid DEFAULT NULL,
  p_vendor text DEFAULT NULL,
  p_expense_date date DEFAULT CURRENT_DATE,
  p_receipt_url text DEFAULT NULL,
  p_payment_method public.payment_method DEFAULT NULL,
  p_payment_reference text DEFAULT NULL,
  p_paid_at date DEFAULT NULL,
  p_bill_number text DEFAULT NULL,
  p_is_paid boolean DEFAULT true,
  p_employee_user_id uuid DEFAULT NULL,
  p_auto_recover boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_expense_id uuid;
  v_advance_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;
  IF p_description IS NULL OR btrim(p_description) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Description is required');
  END IF;
  IF p_expense_type = 'salary_advance' AND p_employee_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select the staff member receiving the advance');
  END IF;
  IF NOT (
    has_role(v_uid,'owner') OR has_role(v_uid,'admin')
    OR ((has_role(v_uid,'manager') OR has_role(v_uid,'staff'))
        AND p_branch_id IN (SELECT user_visible_branch_ids(v_uid)))
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised for this branch');
  END IF;

  INSERT INTO public.expenses (
    branch_id, category_id, amount, description, vendor, expense_date, receipt_url,
    status, submitted_by, expense_type, payment_method, payment_reference,
    paid_at, paid_by, bill_number, is_paid, employee_user_id
  ) VALUES (
    p_branch_id, p_category_id, p_amount, p_description, p_vendor,
    COALESCE(p_expense_date, CURRENT_DATE), p_receipt_url,
    'pending', v_uid, p_expense_type, p_payment_method, p_payment_reference,
    CASE WHEN p_is_paid THEN COALESCE(p_paid_at, CURRENT_DATE) ELSE p_paid_at END,
    CASE WHEN p_is_paid THEN v_uid ELSE NULL END,
    p_bill_number, p_is_paid, p_employee_user_id
  ) RETURNING id INTO v_expense_id;

  IF p_expense_type = 'salary_advance' THEN
    INSERT INTO public.salary_advances (
      branch_id, user_id, expense_id, amount, outstanding, paid_on,
      payment_method, payment_reference, reason, auto_recover, created_by
    ) VALUES (
      p_branch_id, p_employee_user_id, v_expense_id, p_amount, p_amount,
      COALESCE(p_paid_at, p_expense_date, CURRENT_DATE),
      p_payment_method, p_payment_reference, p_description,
      COALESCE(p_auto_recover, true), v_uid
    ) RETURNING id INTO v_advance_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'expense_id', v_expense_id, 'advance_id', v_advance_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.record_expense(uuid,numeric,text,public.expense_kind,uuid,text,date,text,public.payment_method,text,date,text,boolean,uuid,boolean) TO authenticated;

-- 4. edit_expense (owner/admin, reason mandatory)
CREATE OR REPLACE FUNCTION public.edit_expense(
  p_expense_id uuid,
  p_reason text,
  p_amount numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_vendor text DEFAULT NULL,
  p_expense_date date DEFAULT NULL,
  p_payment_method public.payment_method DEFAULT NULL,
  p_payment_reference text DEFAULT NULL,
  p_paid_at date DEFAULT NULL,
  p_bill_number text DEFAULT NULL,
  p_is_paid boolean DEFAULT NULL,
  p_receipt_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.expenses;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason for the correction is required');
  END IF;
  IF NOT (has_role(v_uid,'owner') OR has_role(v_uid,'admin')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and admins can edit expenses');
  END IF;

  SELECT * INTO v_row FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Expense not found');
  END IF;

  UPDATE public.expenses SET
    amount = COALESCE(p_amount, amount),
    description = COALESCE(p_description, description),
    category_id = COALESCE(p_category_id, category_id),
    vendor = COALESCE(p_vendor, vendor),
    expense_date = COALESCE(p_expense_date, expense_date),
    payment_method = COALESCE(p_payment_method, payment_method),
    payment_reference = COALESCE(p_payment_reference, payment_reference),
    paid_at = COALESCE(p_paid_at, paid_at),
    bill_number = COALESCE(p_bill_number, bill_number),
    is_paid = COALESCE(p_is_paid, is_paid),
    receipt_url = COALESCE(p_receipt_url, receipt_url),
    edit_reason = p_reason
  WHERE id = p_expense_id;

  -- keep linked advance in sync
  UPDATE public.salary_advances sa SET
    amount = COALESCE(p_amount, sa.amount),
    outstanding = LEAST(sa.outstanding, COALESCE(p_amount, sa.amount)),
    payment_method = COALESCE(p_payment_method, sa.payment_method),
    payment_reference = COALESCE(p_payment_reference, sa.payment_reference)
  WHERE sa.expense_id = p_expense_id AND sa.status = 'outstanding';

  RETURN jsonb_build_object('success', true, 'expense_id', p_expense_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.edit_expense(uuid,text,numeric,text,uuid,text,date,public.payment_method,text,date,text,boolean,text) TO authenticated;

-- 5. Payroll helpers
CREATE OR REPLACE FUNCTION public.pending_advance_for_user(_user_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(outstanding), 0)
  FROM public.salary_advances
  WHERE user_id = _user_id AND status = 'outstanding' AND auto_recover = true;
$$;

GRANT EXECUTE ON FUNCTION public.pending_advance_for_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_advance_recovery(_user_id uuid, _amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining numeric := COALESCE(_amount, 0);
  v_rec record;
  v_take numeric;
BEGIN
  IF NOT (has_role(auth.uid(),'owner') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised');
  END IF;
  FOR v_rec IN
    SELECT id, outstanding FROM public.salary_advances
    WHERE user_id = _user_id AND status = 'outstanding'
    ORDER BY paid_on ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_rec.outstanding, v_remaining);
    UPDATE public.salary_advances
      SET outstanding = outstanding - v_take,
          status = CASE WHEN outstanding - v_take <= 0 THEN 'recovered' ELSE 'outstanding' END
      WHERE id = v_rec.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'applied', COALESCE(_amount,0) - v_remaining);
END; $$;

GRANT EXECUTE ON FUNCTION public.apply_advance_recovery(uuid, numeric) TO authenticated;
