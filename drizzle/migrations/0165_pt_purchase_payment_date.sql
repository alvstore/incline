DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid, date, boolean, boolean, numeric, date, text, text);
CREATE FUNCTION public.purchase_pt_package(_member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric, _gst_rate numeric, _payment_method text, _payment_source text, _idempotency_key text, _received_by uuid DEFAULT NULL::uuid, _start_date date DEFAULT NULL::date, _reassign_member_trainer boolean DEFAULT true, _allow_duplicate boolean DEFAULT false, _amount_paid numeric DEFAULT NULL::numeric, _due_date date DEFAULT NULL::date, _transaction_id text DEFAULT NULL::text, _payment_notes text DEFAULT NULL::text, _payment_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _prev_trainer uuid;
  _existing RECORD;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _backdate_on boolean;
  _inv uuid;
  _pay_ts timestamptz;
BEGIN
  IF public.rpc_guard_applies('purchase_pt_package') THEN
    IF NOT (public.is_own_member(_member_id) OR public.is_branch_staff(_branch_id, true)) THEN
      RAISE EXCEPTION 'forbidden: purchase_pt_package' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_branch_staff(_branch_id, true) THEN
      _received_by := NULL;
      _payment_date := NULL;
    END IF;
  END IF;

  -- Payment received date (backdating) guard
  IF _payment_date IS NOT NULL AND _payment_date <> _today THEN
    IF _payment_date > _today THEN
      RETURN jsonb_build_object('success', false, 'code', 'payment_date_future',
        'error', 'Payment received date cannot be in the future.');
    END IF;
    IF _payment_date < _today - 90 THEN
      RETURN jsonb_build_object('success', false, 'code', 'payment_date_too_old',
        'error', 'Payment received date can be at most 90 days ago.');
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']) THEN
      RETURN jsonb_build_object('success', false, 'code', 'payment_date_forbidden',
        'error', 'Only owners, admins and managers can record an earlier payment date.');
    END IF;
    SELECT COALESCE((value #>> '{}')::boolean, true) INTO _backdate_on
    FROM public.settings WHERE key = 'pt_backdate_payments'
      AND (branch_id = _branch_id OR branch_id IS NULL)
    ORDER BY branch_id NULLS LAST LIMIT 1;
    IF _backdate_on IS FALSE THEN
      RETURN jsonb_build_object('success', false, 'code', 'payment_date_disabled',
        'error', 'Recording an earlier payment date is switched off for this branch.');
    END IF;
  ELSE
    _payment_date := NULL;
  END IF;
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

  IF _payment_date IS NOT NULL
     AND COALESCE((_result ->> 'success')::boolean, false)
     AND COALESCE((_result ->> 'idempotent')::boolean, false) IS NOT TRUE THEN
    _inv := (_result ->> 'invoice_id')::uuid;
    _pay_ts := (_payment_date::timestamp + time '12:00') AT TIME ZONE 'Asia/Kolkata';
    UPDATE public.invoices SET created_at = _pay_ts WHERE id = _inv;
    UPDATE public.payments SET payment_date = _pay_ts WHERE invoice_id = _inv AND status = 'completed'::payment_status;
    UPDATE public.payment_transactions SET received_at = _pay_ts WHERE invoice_id = _inv;
    UPDATE public.trainer_commissions SET sale_date = _payment_date
      WHERE pt_package_id = (_result ->> 'member_package_id')::uuid;
    UPDATE public.pt_commission_installments SET payout_month = date_trunc('month', _payment_date)::date
      WHERE commission_id IN (SELECT id FROM public.trainer_commissions
                              WHERE pt_package_id = (_result ->> 'member_package_id')::uuid)
        AND paid_at IS NULL AND payout_month > date_trunc('month', _payment_date)::date;
    BEGIN
      INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_values, new_values)
      VALUES (_branch_id, auth.uid(), 'pt_payment_backdated', 'invoices', _inv,
        jsonb_build_object('payment_date', _today),
        jsonb_build_object('payment_date', _payment_date,
          'member_package_id', _result ->> 'member_package_id',
          'amount', _result ->> 'amount_collected'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    _result := _result || jsonb_build_object('payment_date', _payment_date);
  END IF;

  RETURN _result;
END;
$function$;
REVOKE ALL ON FUNCTION public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid, date, boolean, boolean, numeric, date, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid, date, boolean, boolean, numeric, date, text, text, date) TO authenticated, service_role;
