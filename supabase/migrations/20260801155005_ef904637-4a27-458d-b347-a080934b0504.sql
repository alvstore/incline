-- 1. Calendar-correct PT expiry helper
CREATE OR REPLACE FUNCTION public.pt_calendar_expiry(p_start date, p_months integer, p_validity_days integer DEFAULT NULL)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(p_months, 0) > 0
      THEN (p_start + make_interval(months => p_months) - interval '1 day')::date
    ELSE (p_start + make_interval(days => GREATEST(COALESCE(p_validity_days, 30) - 1, 0)))::date
  END;
$$;

-- 2. Purchase impl: calendar expiry + optional start date
CREATE OR REPLACE FUNCTION public._purchase_pt_package_impl(
  _member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric,
  _gst_rate numeric DEFAULT 5, _payment_method text DEFAULT 'cash'::text,
  _payment_source text DEFAULT 'in_person'::text, _idempotency_key text DEFAULT NULL::text,
  _received_by uuid DEFAULT auth.uid(), _start_date date DEFAULT NULL)
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

  IF _gst_rate IS NULL OR _gst_rate <> 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PT GST is fixed at 5%');
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
    _subtotal, 1, 5, _tax, _price_paid, 'pt_package', _member_package_id
  );

  _commission_amount := round(_subtotal * (_commission_rate / 100.0), 2);

  IF _trainer_id IS NOT NULL THEN
    IF _package.package_type = 'monthly'::pt_package_type AND COALESCE(_package.duration_months, 0) > 0 THEN
      _monthly_commission := round(_commission_amount / _package.duration_months, 2);
      FOR i IN 0..(_package.duration_months - 1) LOOP
        INSERT INTO public.trainer_commissions (
          trainer_id, pt_package_id, commission_type, amount, percentage,
          status, kind, release_date, notes
        ) VALUES (
          _trainer_id, _member_package_id, 'package_sale',
          _monthly_commission, _commission_rate,
          'pending', 'earned_unconfirmed',
          (_start + make_interval(months => i))::date,
          'Awaiting payment confirmation'
        );
      END LOOP;
    ELSE
      INSERT INTO public.trainer_commissions (
        trainer_id, pt_package_id, commission_type, amount, percentage,
        status, kind, release_date, notes
      ) VALUES (
        _trainer_id, _member_package_id, 'package_sale',
        _commission_amount, _commission_rate,
        'pending', 'earned_unconfirmed', _start,
        'Awaiting payment confirmation'
      );
    END IF;
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

-- purchase wrapper gains the same optional start date
CREATE OR REPLACE FUNCTION public.purchase_pt_package(
  _member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric,
  _gst_rate numeric DEFAULT 5, _payment_method text DEFAULT 'cash'::text,
  _payment_source text DEFAULT 'in_person'::text, _idempotency_key text DEFAULT NULL::text,
  _received_by uuid DEFAULT auth.uid(), _start_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _gst_rate IS NULL OR _gst_rate <> 5 THEN
    RAISE EXCEPTION 'pt_gst_must_be_5'
      USING HINT = 'Personal training GST is fixed at 5% (inclusive).';
  END IF;
  RETURN public._purchase_pt_package_impl(
    _member_id, _package_id, _trainer_id, _branch_id, _price_paid,
    _gst_rate, _payment_method, _payment_source, _idempotency_key, _received_by, _start_date
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid);
DROP FUNCTION IF EXISTS public._purchase_pt_package_impl(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid);

-- 3. Renew an existing PT package (monthly-first continuation, no gap)
CREATE OR REPLACE FUNCTION public.renew_pt_package(
  _member_package_id uuid,
  _price numeric DEFAULT NULL,
  _payment_method text DEFAULT 'cash',
  _payment_source text DEFAULT 'in_person',
  _idempotency_key text DEFAULT NULL,
  _package_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _old record;
  _pkg record;
  _start date;
  _price_final numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO _old FROM public.member_pt_packages WHERE id = _member_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  IF _old.status NOT IN ('active'::pt_package_status, 'expired'::pt_package_status, 'exhausted'::pt_package_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only active or finished packages can be renewed', 'status', _old.status);
  END IF;

  SELECT * INTO _pkg FROM public.pt_packages
   WHERE id = COALESCE(_package_id, _old.package_id) AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found or inactive');
  END IF;

  _start := GREATEST(CURRENT_DATE, COALESCE(_old.expiry_date, CURRENT_DATE) + 1);
  _price_final := COALESCE(_price, _pkg.price);

  RETURN public._purchase_pt_package_impl(
    _old.member_id, _pkg.id, _old.trainer_id, _old.branch_id, _price_final,
    5, _payment_method, _payment_source,
    COALESCE(_idempotency_key, 'renew-' || _member_package_id::text || '-' || _start::text),
    auth.uid(), _start
  ) || jsonb_build_object('renewed_from', _member_package_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.renew_pt_package(uuid, numeric, text, text, text, uuid) TO authenticated;

-- 4. Daily expiry sweep for PT packages
CREATE OR REPLACE FUNCTION public.expire_pt_packages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _expired int := 0;
  _exhausted int := 0;
BEGIN
  UPDATE public.member_pt_packages
     SET status = 'expired'::pt_package_status, updated_at = now()
   WHERE status = 'active'::pt_package_status
     AND expiry_date IS NOT NULL
     AND expiry_date < CURRENT_DATE;
  GET DIAGNOSTICS _expired = ROW_COUNT;

  UPDATE public.member_pt_packages
     SET status = 'exhausted'::pt_package_status, updated_at = now()
   WHERE status = 'active'::pt_package_status
     AND package_type = 'session_based'::pt_package_type
     AND COALESCE(sessions_remaining, 0) <= 0;
  GET DIAGNOSTICS _exhausted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'expired', _expired, 'exhausted', _exhausted, 'dispatched', _expired + _exhausted);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.expire_pt_packages() TO authenticated, service_role;

-- 5. log_pt_session: real trainer commission for session-based packs
CREATE OR REPLACE FUNCTION public.log_pt_session(p_member_pt_package_id uuid, p_trainer_id uuid, p_status text DEFAULT 'completed'::text, p_notes text DEFAULT NULL::text)
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
  v_rate numeric;
  v_amount numeric;
BEGIN
  IF NOT public.has_any_role(v_caller, ARRAY['owner','admin','manager','trainer']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_status := CASE lower(coalesce(p_status, 'completed'))
    WHEN 'present'  THEN 'completed'::public.pt_session_status
    WHEN 'completed' THEN 'completed'::public.pt_session_status
    WHEN 'late'     THEN 'late'::public.pt_session_status
    WHEN 'absent'   THEN 'absent'::public.pt_session_status
    WHEN 'holiday'  THEN 'holiday'::public.pt_session_status
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

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
    IF COALESCE(v_pkg.sessions_remaining, 0) <= 0 THEN RAISE EXCEPTION 'no_sessions_left'; END IF;
  ELSIF v_pkg.package_type = 'monthly' AND v_consumes_session THEN
    IF CURRENT_DATE > v_pkg.expiry_date THEN RAISE EXCEPTION 'package_expired'; END IF;
  END IF;

  INSERT INTO public.pt_sessions (
    member_pt_package_id, trainer_id, branch_id,
    scheduled_at, status, notes, duration_minutes
  ) VALUES (
    v_pkg.id, p_trainer_id, v_pkg.branch_id, now(), v_status, p_notes, 60
  ) RETURNING id INTO v_session_id;

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

-- 6. Retire the legacy session completer (crashed on monthly packs)
DROP FUNCTION IF EXISTS public.complete_pt_session(uuid, text);