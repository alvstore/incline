-- 1. Blocked state on PT commission instalments
ALTER TABLE public.pt_commission_installments
  DROP CONSTRAINT IF EXISTS pt_commission_installments_status_check;

ALTER TABLE public.pt_commission_installments
  ADD CONSTRAINT pt_commission_installments_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'blocked'::text, 'paid'::text, 'cancelled'::text]));

ALTER TABLE public.pt_commission_installments
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pt_comm_inst_commission ON public.pt_commission_installments(commission_id);
CREATE INDEX IF NOT EXISTS idx_pt_comm_inst_status_month ON public.pt_commission_installments(status, payout_month);

-- 2. Commission generation: hold instalments while the PT invoice has a balance
CREATE OR REPLACE FUNCTION public.generate_pt_commission(_member_package_id uuid, _payment_mode text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  _balance numeric := 0;
  _status text;
  _reason text;
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

  IF _pkg.invoice_id IS NOT NULL THEN
    SELECT GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0)
      INTO _balance
      FROM public.invoices WHERE id = _pkg.invoice_id;
  END IF;
  _balance := COALESCE(_balance, 0);

  IF _balance > 0 THEN
    _status := 'blocked';
    _reason := 'Member dues outstanding: ' || to_char(_balance, 'FM999999990.00');
  ELSE
    _status := 'pending';
    _reason := NULL;
  END IF;

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
      commission_id, trainer_id, branch_id, payout_month, installment_index,
      installment_amount, status, blocked_reason, released_at
    ) VALUES (
      _commission_id, _pkg.trainer_id, _pkg.branch_id,
      (date_trunc('month', COALESCE(_pkg.start_date, CURRENT_DATE)::timestamp) + make_interval(months => i))::date,
      i + 1, _amt, _status, _reason,
      CASE WHEN _status = 'pending' THEN now() ELSE NULL END
    );
  END LOOP;

  RETURN _net;
END;
$function$;

-- 3. Release held instalments once the PT invoice is fully paid
CREATE OR REPLACE FUNCTION public.release_pt_commission_for_invoice(_invoice_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _balance numeric;
  _released int := 0;
BEGIN
  IF _invoice_id IS NULL THEN RETURN 0; END IF;

  SELECT GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0)
    INTO _balance FROM public.invoices WHERE id = _invoice_id;

  IF _balance IS NULL OR _balance > 0 THEN RETURN 0; END IF;

  WITH upd AS (
    UPDATE public.pt_commission_installments i
       SET status = 'pending',
           blocked_reason = NULL,
           released_at = now(),
           -- a month that already passed becomes payable in the current payroll month
           payout_month = GREATEST(i.payout_month, date_trunc('month', CURRENT_DATE)::date),
           updated_at = now()
     WHERE i.status = 'blocked'
       AND i.commission_id IN (
         SELECT tc.id
           FROM public.trainer_commissions tc
           JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
          WHERE mp.invoice_id = _invoice_id
            AND COALESCE(tc.kind,'earned') = 'earned'
            AND tc.status NOT IN ('reversed','cancelled')
       )
     RETURNING 1
  )
  SELECT count(*) INTO _released FROM upd;

  RETURN _released;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_pt_commission_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed'::payment_status AND NEW.invoice_id IS NOT NULL THEN
    PERFORM public.release_pt_commission_for_invoice(NEW.invoice_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pt_commission_release ON public.payments;
CREATE TRIGGER trg_pt_commission_release
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_pt_commission_release();

-- 4. Re-block / cancel instalments when a PT commission is reversed or voided
CREATE OR REPLACE FUNCTION public.tg_pt_commission_cancel_installments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('reversed','cancelled') AND COALESCE(OLD.status,'') NOT IN ('reversed','cancelled') THEN
    UPDATE public.pt_commission_installments
       SET status = 'cancelled',
           blocked_reason = COALESCE(blocked_reason, 'Commission ' || NEW.status),
           updated_at = now()
     WHERE commission_id = NEW.id
       AND status IN ('pending','blocked');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pt_commission_cancel_installments ON public.trainer_commissions;
CREATE TRIGGER trg_pt_commission_cancel_installments
AFTER UPDATE OF status ON public.trainer_commissions
FOR EACH ROW EXECUTE FUNCTION public.tg_pt_commission_cancel_installments();

-- 5. Payroll reads released instalments only
CREATE OR REPLACE FUNCTION public.pt_commission_due_for_period(_user_id uuid, _period_start date, _period_end date)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(i.installment_amount), 0)
  FROM public.pt_commission_installments i
  JOIN public.trainers t ON t.id = i.trainer_id
  WHERE t.user_id = _user_id
    AND i.status = 'pending'
    AND i.payout_month >= date_trunc('month', _period_start)::date
    AND i.payout_month <= _period_end;
$function$;

-- 6. Trainers may only mark attendance for their own assigned clients
CREATE OR REPLACE FUNCTION public.log_pt_session(p_member_pt_package_id uuid, p_trainer_id uuid, p_status text DEFAULT 'completed'::text, p_notes text DEFAULT NULL::text, p_session_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg public.member_pt_packages%ROWTYPE;
  v_session_id uuid;
  v_caller uuid := auth.uid();
  v_already_checked_in boolean;
  v_status public.pt_session_status;
  v_consumes_session boolean;
  v_creates_checkin boolean;
  v_is_manager boolean;
  v_caller_trainer_id uuid;
BEGIN
  v_is_manager := public.has_any_role(v_caller, ARRAY['owner','admin','manager']::app_role[]);

  IF NOT v_is_manager
     AND NOT public.has_any_role(v_caller, ARRAY['trainer']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_status := CASE lower(coalesce(p_status, 'completed'))
    WHEN 'present'   THEN 'completed'::public.pt_session_status
    WHEN 'completed' THEN 'completed'::public.pt_session_status
    WHEN 'late'      THEN 'late'::public.pt_session_status
    WHEN 'absent'    THEN 'absent'::public.pt_session_status
    WHEN 'holiday'   THEN 'holiday'::public.pt_session_status
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_consumes_session := v_status IN ('completed','late','absent');
  v_creates_checkin  := v_status IN ('completed','late');

  SELECT * INTO v_pkg FROM public.member_pt_packages WHERE id = p_member_pt_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF v_pkg.status <> 'active' THEN RAISE EXCEPTION 'package_not_active'; END IF;

  -- Ownership guard: a plain trainer can only mark their own assigned clients
  IF NOT v_is_manager THEN
    SELECT id INTO v_caller_trainer_id FROM public.trainers WHERE user_id = v_caller LIMIT 1;
    IF v_caller_trainer_id IS NULL OR v_pkg.trainer_id IS DISTINCT FROM v_caller_trainer_id THEN
      RAISE EXCEPTION 'not_your_client';
    END IF;
    p_trainer_id := v_caller_trainer_id;
  END IF;

  p_trainer_id := COALESCE(p_trainer_id, v_pkg.trainer_id);

  IF v_consumes_session
     AND v_pkg.start_date IS NOT NULL
     AND CURRENT_DATE < v_pkg.start_date THEN
    RAISE EXCEPTION 'package_not_started_%', to_char(v_pkg.start_date, 'DD Mon YYYY');
  END IF;

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
    IF COALESCE(v_pkg.sessions_remaining, 0) <= 0 THEN RAISE EXCEPTION 'no_sessions_left'; END IF;
  ELSIF v_pkg.package_type = 'monthly' AND v_consumes_session THEN
    IF CURRENT_DATE > v_pkg.expiry_date THEN RAISE EXCEPTION 'package_expired'; END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    UPDATE public.pt_sessions
       SET status = v_status,
           notes = COALESCE(p_notes, notes),
           updated_at = now()
     WHERE id = p_session_id
       AND status = 'scheduled'::public.pt_session_status
     RETURNING id INTO v_session_id;
    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'session_not_scheduled';
    END IF;
  ELSE
    INSERT INTO public.pt_sessions (
      member_pt_package_id, trainer_id, branch_id,
      scheduled_at, status, notes, duration_minutes
    ) VALUES (
      v_pkg.id, p_trainer_id, v_pkg.branch_id, now(), v_status, p_notes, 60
    ) RETURNING id INTO v_session_id;
  END IF;

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
    UPDATE public.member_pt_packages
      SET sessions_used = COALESCE(sessions_used, 0) + 1,
          sessions_remaining = GREATEST(0, COALESCE(sessions_remaining, 0) - 1),
          status = CASE
            WHEN COALESCE(sessions_remaining, 0) - 1 <= 0 THEN 'exhausted'::pt_package_status
            ELSE status
          END,
          updated_at = now()
      WHERE id = v_pkg.id
      RETURNING sessions_remaining INTO v_pkg.sessions_remaining;
  END IF;

  IF v_creates_checkin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.member_attendance
      WHERE member_id = v_pkg.member_id AND check_in::date = CURRENT_DATE
    ) INTO v_already_checked_in;

    IF NOT v_already_checked_in THEN
      BEGIN
        INSERT INTO public.member_attendance (
          member_id, branch_id, check_in, check_in_method, notes
        ) VALUES (
          v_pkg.member_id, v_pkg.branch_id, now(), 'pt_session',
          'Auto check-in via PT session ' || v_session_id::text
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  ELSE
    v_already_checked_in := true;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'member_id', v_pkg.member_id,
    'branch_id', v_pkg.branch_id,
    'package_type', v_pkg.package_type,
    'status', v_status,
    'sessions_remaining', v_pkg.sessions_remaining,
    'expiry_date', v_pkg.expiry_date,
    'gym_check_in_created', (v_creates_checkin AND NOT v_already_checked_in)
  );
END;
$function$;

-- 7. RLS: trainer-scoped writes on pt_sessions
DROP POLICY IF EXISTS "Staff manage pt sessions" ON public.pt_sessions;

CREATE POLICY "Management manage pt sessions"
ON public.pt_sessions FOR ALL TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[])
  AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[])
  AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

CREATE POLICY "Trainers manage own client pt sessions"
ON public.pt_sessions FOR ALL TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['trainer']::app_role[])
  AND member_pt_package_id IN (
    SELECT mp.id FROM public.member_pt_packages mp
     WHERE mp.trainer_id IN (SELECT t.id FROM public.trainers t WHERE t.user_id = auth.uid())
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['trainer']::app_role[])
  AND member_pt_package_id IN (
    SELECT mp.id FROM public.member_pt_packages mp
     WHERE mp.trainer_id IN (SELECT t.id FROM public.trainers t WHERE t.user_id = auth.uid())
  )
);