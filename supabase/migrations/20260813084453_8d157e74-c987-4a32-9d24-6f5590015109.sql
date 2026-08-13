-- Epic 1: PT commission deferral + payroll installments

ALTER TABLE public.trainer_commissions
  ADD COLUMN IF NOT EXISTS member_id uuid,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS sale_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS plan_duration_months integer,
  ADD COLUMN IF NOT EXISTS total_sale_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS base_commission numeric,
  ADD COLUMN IF NOT EXISTS gst_deduction numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_total_commission numeric;

CREATE TABLE IF NOT EXISTS public.pt_commission_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id uuid NOT NULL REFERENCES public.trainer_commissions(id) ON DELETE CASCADE,
  trainer_id uuid NOT NULL REFERENCES public.trainers(id),
  branch_id uuid,
  payout_month date NOT NULL,
  installment_index integer NOT NULL DEFAULT 1,
  installment_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payroll_item_id uuid,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pt_commission_installments_status_check CHECK (status IN ('pending','paid','cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pt_commission_installments TO authenticated;
GRANT ALL ON public.pt_commission_installments TO service_role;
ALTER TABLE public.pt_commission_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pt_installments_admin_manage" ON public.pt_commission_installments;
CREATE POLICY "pt_installments_admin_manage" ON public.pt_commission_installments
  FOR ALL TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (public.has_role(auth.uid(),'manager'::app_role) AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = pt_commission_installments.trainer_id
        AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    ))
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (public.has_role(auth.uid(),'manager'::app_role) AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = pt_commission_installments.trainer_id
        AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    ))
  );

DROP POLICY IF EXISTS "pt_installments_trainer_read_own" ON public.pt_commission_installments;
CREATE POLICY "pt_installments_trainer_read_own" ON public.pt_commission_installments
  FOR SELECT TO authenticated
  USING (trainer_id IN (SELECT id FROM public.trainers WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS pt_commission_installments_month_idx
  ON public.pt_commission_installments (payout_month, trainer_id, status);
CREATE INDEX IF NOT EXISTS pt_commission_installments_commission_idx
  ON public.pt_commission_installments (commission_id);

DROP TRIGGER IF EXISTS trg_pt_commission_installments_updated_at ON public.pt_commission_installments;
CREATE TRIGGER trg_pt_commission_installments_updated_at
  BEFORE UPDATE ON public.pt_commission_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Commission generator: locks full-value commission at sale, amortises monthly
CREATE OR REPLACE FUNCTION public.generate_pt_commission(_member_package_id uuid, _payment_mode text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _pkg RECORD;
  _rate numeric;
  _months integer;
  _base numeric;
  _gst numeric;
  _net numeric;
  _per numeric;
  _commission_id uuid;
  _remaining numeric;
  _amt numeric;
  i integer;
BEGIN
  SELECT mp.*, p.duration_months AS plan_months
    INTO _pkg
    FROM public.member_pt_packages mp
    JOIN public.pt_packages p ON p.id = mp.package_id
   WHERE mp.id = _member_package_id;

  IF NOT FOUND OR _pkg.trainer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(pt_share_percentage, 40) INTO _rate FROM public.trainers WHERE id = _pkg.trainer_id;
  _rate := COALESCE(_rate, 40);

  _months := GREATEST(COALESCE(_pkg.plan_months, 1), 1);

  _base := round(COALESCE(_pkg.price_paid,0) * (_rate / 100.0), 2);
  _gst  := CASE WHEN lower(COALESCE(_payment_mode,'cash')) = 'cash' THEN 0 ELSE round(_base * 0.05, 2) END;
  _net  := round(_base - _gst, 2);

  DELETE FROM public.trainer_commissions WHERE pt_package_id = _member_package_id;

  INSERT INTO public.trainer_commissions (
    trainer_id, pt_package_id, member_id, branch_id, commission_type,
    amount, percentage, status, kind, release_date, sale_date,
    plan_duration_months, total_sale_amount, payment_mode,
    base_commission, gst_deduction, net_total_commission
  ) VALUES (
    _pkg.trainer_id, _member_package_id, _pkg.member_id, _pkg.branch_id, 'package_sale',
    _net, _rate, 'pending', 'earned', COALESCE(_pkg.start_date, CURRENT_DATE), COALESCE(_pkg.start_date, CURRENT_DATE),
    _months, _pkg.price_paid, lower(COALESCE(_payment_mode,'cash')),
    _base, _gst, _net
  ) RETURNING id INTO _commission_id;

  _per := round(_net / _months, 2);
  _remaining := _net;

  FOR i IN 0.._months - 1 LOOP
    _amt := CASE WHEN i = _months - 1 THEN round(_remaining, 2) ELSE _per END;
    _remaining := _remaining - _amt;
    INSERT INTO public.pt_commission_installments (
      commission_id, trainer_id, branch_id, payout_month, installment_index, installment_amount
    ) VALUES (
      _commission_id, _pkg.trainer_id, _pkg.branch_id,
      (date_trunc('month', COALESCE(_pkg.start_date, CURRENT_DATE)::timestamp) + make_interval(months => i))::date,
      i + 1, _amt
    );
  END LOOP;

  RETURN _net;
END;
$fn$;

-- Pending PT installment total for a staff user in a payroll period
CREATE OR REPLACE FUNCTION public.pt_commission_due_for_period(_user_id uuid, _period_start date, _period_end date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(SUM(i.installment_amount), 0)
  FROM public.pt_commission_installments i
  JOIN public.trainers t ON t.id = i.trainer_id
  WHERE t.user_id = _user_id
    AND i.status = 'pending'
    AND i.payout_month >= date_trunc('month', _period_start)::date
    AND i.payout_month <= _period_end;
$fn$;

CREATE OR REPLACE FUNCTION public._purchase_pt_package_impl(_member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric, _gst_rate numeric DEFAULT 5, _payment_method text DEFAULT 'cash'::text, _payment_source text DEFAULT 'in_person'::text, _idempotency_key text DEFAULT NULL::text, _received_by uuid DEFAULT auth.uid(), _start_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _package RECORD;
  _member_package_id uuid;
  _invoice_id uuid;
  _existing_id uuid;
  _commission_rate numeric;
  _subtotal numeric;
  _tax numeric;
  _commission_amount numeric;
  _monthly_commission numeric;
  _settle_result jsonb;
  _start date;
  _expiry date;
  i integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF _gst_rate IS NULL OR _gst_rate NOT IN (0, 5) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PT GST must be 5% or 0% (exempt)');
  END IF;

  IF _price_paid IS NULL OR _price_paid <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Price must be > 0');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id, invoice_id INTO _existing_id, _invoice_id
    FROM public.member_pt_packages
    WHERE idempotency_key = _idempotency_key
    LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true,
        'member_package_id', _existing_id, 'invoice_id', _invoice_id);
    END IF;
  END IF;

  SELECT * INTO _package FROM public.pt_packages WHERE id = _package_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  SELECT COALESCE(pt_share_percentage, 20) INTO _commission_rate
  FROM public.trainers WHERE id = _trainer_id;
  _commission_rate := COALESCE(_commission_rate, 20);

  _subtotal := round(_price_paid / (1 + _gst_rate / 100.0), 2);
  _tax := round(_price_paid - _subtotal, 2);

  _start := COALESCE(_start_date, CURRENT_DATE);
  _expiry := CASE
    WHEN _package.package_type = 'monthly'::pt_package_type
      THEN public.pt_calendar_expiry(_start, COALESCE(_package.duration_months, 1), _package.validity_days)
    ELSE public.pt_calendar_expiry(_start, NULL, COALESCE(_package.validity_days, 30))
  END;

  INSERT INTO public.member_pt_packages (
    member_id, package_id, trainer_id, branch_id,
    sessions_total, sessions_remaining, price_paid,
    subtotal, tax_amount, gst_rate,
    start_date, expiry_date,
    status, payment_status,
    idempotency_key, expires_pending_at, package_type
  ) VALUES (
    _member_id, _package_id, _trainer_id, _branch_id,
    CASE WHEN _package.package_type = 'monthly'::pt_package_type THEN 0 ELSE _package.total_sessions END,
    CASE WHEN _package.package_type = 'monthly'::pt_package_type THEN 0 ELSE _package.total_sessions END,
    _price_paid,
    _subtotal, _tax, _gst_rate,
    _start, _expiry,
    'pending_payment'::pt_package_status,
    'unpaid',
    _idempotency_key,
    now() + interval '30 minutes',
    _package.package_type
  ) RETURNING id INTO _member_package_id;

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, tax_amount, total_amount, amount_paid,
    status, due_date, invoice_type, notes
  ) VALUES (
    _branch_id, _member_id, _subtotal, _tax, _price_paid, 0,
    'pending'::invoice_status, CURRENT_DATE, 'pt_package',
    'PT pkg ' || _package.name || COALESCE(' | idem:' || _idempotency_key, '')
  ) RETURNING id INTO _invoice_id;

  UPDATE public.member_pt_packages SET invoice_id = _invoice_id WHERE id = _member_package_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, unit_price, quantity,
    tax_rate, tax_amount, total_amount, reference_type, reference_id
  ) VALUES (
    _invoice_id,
    'PT Package - ' || _package.name || ' (' || to_char(_start, 'DD Mon YYYY') || ' – ' || to_char(_expiry, 'DD Mon YYYY') || ')',
    _subtotal, 1, _gst_rate, _tax, _price_paid, 'pt_package', _member_package_id
  );

  IF _trainer_id IS NOT NULL THEN
    _commission_amount := public.generate_pt_commission(_member_package_id, _payment_method);
  ELSE
    _commission_amount := 0;
  END IF;

  IF _payment_source = 'in_person' THEN
    _settle_result := public.settle_payment(
      _branch_id, _invoice_id, _member_id, _price_paid, _payment_method,
      NULL, 'PT package purchase', _received_by, NULL,
      'pt_purchase',
      COALESCE(_idempotency_key, _member_package_id::text),
      NULL, NULL,
      jsonb_build_object('member_pt_package_id', _member_package_id, 'trainer_id', _trainer_id)
    );

    IF COALESCE((_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
      DELETE FROM public.trainer_commissions WHERE pt_package_id = _member_package_id;
      DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
      DELETE FROM public.invoices WHERE id = _invoice_id;
      DELETE FROM public.member_pt_packages WHERE id = _member_package_id;
      RETURN _settle_result;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'member_package_id', _member_package_id,
    'invoice_id', _invoice_id,
    'subtotal', _subtotal,
    'tax_amount', _tax,
    'gst_rate', _gst_rate,
    'start_date', _start,
    'expiry_date', _expiry,
    'commission_base', _subtotal,
    'commission_amount', _commission_amount,
    'status', 'pending_payment',
    'payment_source', _payment_source
  );
END;
$function$;

-- Payroll: include PT installments in run creation
CREATE OR REPLACE FUNCTION public.payroll_create_run(p_branch_id uuid, p_period_start date, p_period_end date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_run_id uuid;
  v_user record;
  v_summary record;
  v_gross numeric;
  v_pt numeric;
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

    INSERT INTO public.payroll_items (
      run_id, user_id, staff_kind,
      calc_base, calc_pt_commission, calc_ot, calc_deductions, calc_gross, calc_net, calc_attendance,
      final_base, final_pt_commission, final_ot, final_deductions, final_gross, final_net
    ) VALUES (
      v_run_id, v_user.user_id, v_user.kind,
      v_summary.base, COALESCE(v_pt,0), v_summary.ot_hours, 0, v_gross, v_gross, v_summary.attendance,
      v_summary.base, COALESCE(v_pt,0), v_summary.ot_hours, 0, v_gross, v_gross
    )
    ON CONFLICT (run_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.payroll_audit (run_id, actor_id, action, after_data)
  VALUES (v_run_id, auth.uid(), 'run_created',
          jsonb_build_object('branch_id', p_branch_id, 'period_start', p_period_start, 'period_end', p_period_end));

  RETURN v_run_id;
END;
$fn$;

-- Payroll: settle the PT installments covered by a paid payroll item
CREATE OR REPLACE FUNCTION public.payroll_mark_paid(p_item_ids uuid[], p_method text, p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_item record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners/admins can mark payroll as paid';
  END IF;

  UPDATE public.payroll_items
    SET status = 'paid', payment_method = p_method, payment_reference = p_reference, updated_at = now()
    WHERE id = ANY(p_item_ids) AND status = 'processed';

  FOR v_item IN
    SELECT pi.id, pi.user_id, pr.period_start, pr.period_end
      FROM public.payroll_items pi
      JOIN public.payroll_runs pr ON pr.id = pi.run_id
     WHERE pi.id = ANY(p_item_ids) AND pi.status = 'paid'
  LOOP
    UPDATE public.pt_commission_installments i
       SET status = 'paid', paid_at = now(), payroll_item_id = v_item.id, updated_at = now()
      FROM public.trainers t
     WHERE t.id = i.trainer_id
       AND t.user_id = v_item.user_id
       AND i.status = 'pending'
       AND i.payout_month >= date_trunc('month', v_item.period_start)::date
       AND i.payout_month <= v_item.period_end;
  END LOOP;

  INSERT INTO public.payroll_audit (item_id, actor_id, action, after_data)
    SELECT unnest(p_item_ids), auth.uid(), 'item_paid',
           jsonb_build_object('method', p_method, 'reference', p_reference);
END;
$fn$;