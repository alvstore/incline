DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date,boolean);
DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date,boolean,boolean);
DROP FUNCTION IF EXISTS public._purchase_pt_package_impl(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date);

CREATE OR REPLACE FUNCTION public._purchase_pt_package_impl(
  _member_id uuid,
  _package_id uuid,
  _trainer_id uuid,
  _branch_id uuid,
  _price_paid numeric,
  _gst_rate numeric DEFAULT 5,
  _payment_method text DEFAULT 'cash'::text,
  _payment_source text DEFAULT 'in_person'::text,
  _idempotency_key text DEFAULT NULL::text,
  _received_by uuid DEFAULT auth.uid(),
  _start_date date DEFAULT NULL::date,
  _amount_paid numeric DEFAULT NULL::numeric,
  _due_date date DEFAULT NULL::date,
  _transaction_id text DEFAULT NULL::text,
  _payment_notes text DEFAULT NULL::text
)
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
  _settle_result jsonb;
  _start date;
  _expiry date;
  _collect numeric;
  _balance numeric;
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

  _collect := COALESCE(_amount_paid, _price_paid);
  IF _collect < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount collected cannot be negative');
  END IF;
  IF _collect > _price_paid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount collected cannot exceed the package price');
  END IF;
  _balance := round(_price_paid - _collect, 2);

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
    'pending'::invoice_status, COALESCE(_due_date, CURRENT_DATE), 'pt_package',
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

  IF _payment_source = 'in_person' AND _collect > 0 THEN
    _settle_result := public.settle_payment(
      _branch_id, _invoice_id, _member_id, _collect, _payment_method,
      _transaction_id,
      COALESCE(_payment_notes, 'PT package purchase'),
      _received_by, NULL,
      'pt_purchase',
      COALESCE(_idempotency_key, _member_package_id::text),
      NULL, NULL,
      jsonb_build_object(
        'member_pt_package_id', _member_package_id,
        'trainer_id', _trainer_id,
        'balance_due', _balance
      )
    );

    IF COALESCE((_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
      DELETE FROM public.trainer_commissions WHERE pt_package_id = _member_package_id;
      DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
      DELETE FROM public.invoices WHERE id = _invoice_id;
      DELETE FROM public.member_pt_packages WHERE id = _member_package_id;
      RETURN _settle_result;
    END IF;

    -- Part payment: the package still starts now; the balance rides on the invoice.
    IF _balance > 0 THEN
      UPDATE public.member_pt_packages
      SET status = 'active'::pt_package_status,
          payment_status = 'partial',
          expires_pending_at = NULL
      WHERE id = _member_package_id
        AND status = 'pending_payment'::pt_package_status;

      UPDATE public.trainer_commissions
      SET kind = 'earned', notes = NULL
      WHERE pt_package_id = _member_package_id AND kind = 'earned_unconfirmed';
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
    'amount_collected', _collect,
    'balance_due', _balance,
    'due_date', COALESCE(_due_date, CURRENT_DATE),
    'transaction_id', _transaction_id,
    'status', CASE WHEN _payment_source = 'in_person' AND _collect > 0 AND _balance > 0 THEN 'active' ELSE 'pending_payment' END,
    'payment_source', _payment_source
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_pt_package(
  _member_id uuid,
  _package_id uuid,
  _trainer_id uuid,
  _branch_id uuid,
  _price_paid numeric,
  _gst_rate numeric,
  _payment_method text,
  _payment_source text,
  _idempotency_key text,
  _received_by uuid DEFAULT NULL::uuid,
  _start_date date DEFAULT NULL::date,
  _reassign_member_trainer boolean DEFAULT true,
  _allow_duplicate boolean DEFAULT false,
  _amount_paid numeric DEFAULT NULL::numeric,
  _due_date date DEFAULT NULL::date,
  _transaction_id text DEFAULT NULL::text,
  _payment_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _prev_trainer uuid;
  _existing RECORD;
BEGIN
  IF _gst_rate IS NULL OR _gst_rate NOT IN (0, 5) THEN
    RAISE EXCEPTION 'pt_gst_must_be_0_or_5'
      USING HINT = 'Personal training GST is 5% (inclusive) or 0% for exempt sales.';
  END IF;

  IF NOT COALESCE(_allow_duplicate, false) THEN
    SELECT id, status INTO _existing
    FROM public.member_pt_packages
    WHERE member_id = _member_id
      AND status IN ('active'::pt_package_status, 'pending_payment'::pt_package_status)
      AND (_idempotency_key IS NULL OR idempotency_key IS DISTINCT FROM _idempotency_key)
    ORDER BY created_at DESC
    LIMIT 1;

    IF _existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', CASE WHEN _existing.status = 'pending_payment'::pt_package_status
                      THEN 'This member already has a PT package awaiting payment. Complete or cancel it first.'
                      ELSE 'This member already has an active PT package.' END,
        'code', 'duplicate_pt_package',
        'existing_member_package_id', _existing.id,
        'existing_status', _existing.status
      );
    END IF;
  END IF;

  _result := public._purchase_pt_package_impl(
    _member_id, _package_id, _trainer_id, _branch_id, _price_paid,
    _gst_rate, _payment_method, _payment_source, _idempotency_key, _received_by, _start_date,
    _amount_paid, _due_date, _transaction_id, _payment_notes
  );

  IF COALESCE((_result ->> 'success')::boolean, false)
     AND COALESCE((_result ->> 'idempotent')::boolean, false) IS NOT TRUE
     AND _reassign_member_trainer
     AND _trainer_id IS NOT NULL THEN

    SELECT assigned_trainer_id INTO _prev_trainer FROM public.members WHERE id = _member_id;

    IF _prev_trainer IS DISTINCT FROM _trainer_id THEN
      UPDATE public.members
      SET assigned_trainer_id = _trainer_id,
          updated_at = now()
      WHERE id = _member_id;

      BEGIN
        INSERT INTO public.audit_logs (
          branch_id, user_id, action, table_name, record_id, old_values, new_values
        ) VALUES (
          _branch_id, auth.uid(), 'pt_trainer_reassigned', 'members', _member_id,
          jsonb_build_object('assigned_trainer_id', _prev_trainer),
          jsonb_build_object('assigned_trainer_id', _trainer_id,
                             'reason', 'pt_package_purchase',
                             'member_package_id', _result ->> 'member_package_id')
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      _result := _result || jsonb_build_object(
        'trainer_reassigned', true,
        'previous_trainer_id', _prev_trainer
      );
    END IF;
  END IF;

  RETURN _result;
END;
$function$;

REVOKE ALL ON FUNCTION public._purchase_pt_package_impl(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date,numeric,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._purchase_pt_package_impl(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date,numeric,date,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_pt_package(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date,boolean,boolean,numeric,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_pt_package(uuid,uuid,uuid,uuid,numeric,numeric,text,text,text,uuid,date,boolean,boolean,numeric,date,text,text) TO authenticated, service_role;