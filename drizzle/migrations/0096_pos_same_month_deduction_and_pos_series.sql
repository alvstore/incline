ALTER TABLE public.salary_advances
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS recover_in_month date,
  ADD COLUMN IF NOT EXISTS carried_from date;

-- Month-aware advance due: store purchases recover in full in their own month; manual advances keep the cap.
CREATE OR REPLACE FUNCTION public.payroll_advance_due(p_user_id uuid, p_branch_id uuid, p_payable numeric, p_period_end date)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE v_manual numeric := 0; v_pos numeric := 0; v_cap numeric;
BEGIN
  SELECT COALESCE(SUM(GREATEST(COALESCE(sa.outstanding,0),0)),0) INTO v_manual
    FROM public.salary_advances sa
   WHERE sa.user_id = p_user_id AND COALESCE(sa.auto_recover,true)
     AND COALESCE(sa.status,'outstanding') NOT IN ('recovered','cancelled','settled')
     AND COALESCE(sa.outstanding,0) > 0 AND sa.source <> 'pos';
  SELECT COALESCE(SUM(GREATEST(COALESCE(sa.outstanding,0),0)),0) INTO v_pos
    FROM public.salary_advances sa
   WHERE sa.user_id = p_user_id AND COALESCE(sa.auto_recover,true)
     AND COALESCE(sa.status,'outstanding') NOT IN ('recovered','cancelled','settled')
     AND COALESCE(sa.outstanding,0) > 0 AND sa.source = 'pos'
     AND (p_period_end IS NULL OR COALESCE(sa.recover_in_month, date_trunc('month', sa.paid_on)::date) <= p_period_end);

  IF v_manual > 0 THEN
    SELECT advance_recovery_max_per_month INTO v_cap FROM public.hr_settings
     WHERE p_branch_id IS NOT NULL AND branch_id = p_branch_id LIMIT 1;
    IF v_cap IS NULL THEN
      SELECT advance_recovery_max_per_month INTO v_cap FROM public.hr_settings WHERE branch_id IS NULL LIMIT 1;
    END IF;
    IF v_cap IS NOT NULL AND v_cap > 0 THEN v_manual := LEAST(v_manual, v_cap); END IF;
  END IF;
  RETURN round(LEAST(v_pos + v_manual, GREATEST(COALESCE(p_payable,0),0)), 2);
END $$;
REVOKE ALL ON FUNCTION public.payroll_advance_due(uuid,uuid,numeric,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_advance_due(uuid,uuid,numeric,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payroll_advance_due(p_user_id uuid, p_branch_id uuid, p_payable numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT public.payroll_advance_due(p_user_id, p_branch_id, p_payable, NULL::date) $$;

-- Point payroll run creation/recalculation at the month-aware version.
DO $do$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.payroll_create_run(uuid,date,date)'::regprocedure);
  v_def := replace(v_def, 'payroll_advance_due(v_user.user_id, p_branch_id, v_gross - v_ded_total)',
                          'payroll_advance_due(v_user.user_id, p_branch_id, v_gross - v_ded_total, p_period_end)');
  IF strpos(v_def, 'v_gross - v_ded_total, p_period_end)') = 0 THEN RAISE EXCEPTION 'payroll_create_run patch point not found'; END IF;
  EXECUTE v_def;
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='payroll_recalculate_item' AND pronamespace='public'::regnamespace LIMIT 1;
  v_def := replace(v_def, 'payroll_advance_due(v_item.user_id, v_run.branch_id, v_gross - v_ded_total)',
                          'payroll_advance_due(v_item.user_id, v_run.branch_id, v_gross - v_ded_total, v_run.period_end)');
  IF strpos(v_def, 'v_run.period_end)') = 0 THEN RAISE EXCEPTION 'payroll_recalculate_item patch point not found'; END IF;
  EXECUTE v_def;
END $do$;

-- Recovery closes due store purchases and manual advances first; later-month store purchases last.
CREATE OR REPLACE FUNCTION public.apply_advance_recovery(_user_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining numeric := COALESCE(_amount, 0);
  v_rec record; v_take numeric;
  v_global boolean := has_role(auth.uid(),'owner') OR has_role(auth.uid(),'admin');
  v_guard boolean := public.rpc_guard_applies('apply_advance_recovery');
  v_month date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  IF v_guard AND NOT (v_global OR has_role(auth.uid(),'manager')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised');
  END IF;
  IF v_guard AND NOT v_global AND EXISTS (
       SELECT 1 FROM public.salary_advances sa
        WHERE sa.user_id = _user_id AND sa.status = 'outstanding'
          AND (sa.branch_id IS NULL OR sa.branch_id NOT IN (SELECT public.user_visible_branch_ids(auth.uid())))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised for this employee''s branch');
  END IF;
  FOR v_rec IN
    SELECT id, outstanding FROM public.salary_advances
     WHERE user_id = _user_id AND status = 'outstanding'
     ORDER BY (source = 'pos' AND COALESCE(recover_in_month, date_trunc('month', paid_on)::date) > v_month) ASC,
              (source = 'pos') DESC, paid_on ASC
     FOR UPDATE
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
END; $function$;

-- Store purchases get their recovery month (carried forward when that month's payroll is already approved).
CREATE OR REPLACE FUNCTION public.tg_salary_advance_pos_month()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE v_month date := date_trunc('month', COALESCE(NEW.paid_on, (now() AT TIME ZONE 'Asia/Kolkata')::date))::date;
BEGIN
  IF NEW.source = 'pos' AND NEW.recover_in_month IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.payroll_runs r
                WHERE r.branch_id = NEW.branch_id AND r.period_start <= (v_month + interval '1 month - 1 day')::date
                  AND r.period_end >= v_month
                  AND (r.finalized_at IS NOT NULL OR r.paid_at IS NOT NULL OR r.status IN ('approved','processed','paid'))) THEN
      NEW.carried_from := v_month;
      v_month := (v_month + interval '1 month')::date;
    END IF;
    NEW.recover_in_month := v_month;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_salary_advance_pos_month ON public.salary_advances;
CREATE TRIGGER trg_salary_advance_pos_month BEFORE INSERT ON public.salary_advances
  FOR EACH ROW EXECUTE FUNCTION public.tg_salary_advance_pos_month();

-- Store sale numbers: own POS series, never consuming membership BOS/INV numbers.
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_branch_code TEXT; v_yy TEXT; v_seq INTEGER; v_series TEXT;
BEGIN
  SELECT code INTO v_branch_code FROM public.branches WHERE id = NEW.branch_id;
  IF v_branch_code IS NULL THEN v_branch_code := 'X'; END IF;
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');
  v_series := CASE
    WHEN COALESCE(NEW.is_proforma, false) THEN 'PRO'
    WHEN NEW.pos_sale_id IS NOT NULL OR NEW.source = 'pos' THEN 'POS'
    WHEN COALESCE(NEW.is_gst_invoice, false) THEN 'INV'
    ELSE 'BOS' END;
  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (NEW.branch_id, v_yy, v_series, 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO v_seq;
  NEW.document_series := v_series;
  NEW.invoice_number := v_series || '-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.generate_invoice_number_for(_inv invoices)
RETURNS invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_branch_code TEXT; v_yy TEXT; v_seq INTEGER; v_series TEXT;
BEGIN
  SELECT code INTO v_branch_code FROM public.branches WHERE id = _inv.branch_id;
  IF v_branch_code IS NULL THEN v_branch_code := 'X'; END IF;
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');
  v_series := CASE
    WHEN COALESCE(_inv.is_proforma, false) THEN 'PRO'
    WHEN _inv.pos_sale_id IS NOT NULL OR _inv.source = 'pos' THEN 'POS'
    WHEN COALESCE(_inv.is_gst_invoice, false) THEN 'INV'
    ELSE 'BOS' END;
  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (_inv.branch_id, v_yy, v_series, 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO v_seq;
  _inv.document_series := v_series;
  _inv.invoice_number := v_series || '-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');
  RETURN _inv;
END; $function$;