CREATE OR REPLACE FUNCTION public.purchase_pt_package(_member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric, _gst_rate numeric, _payment_method text, _payment_source text, _idempotency_key text, _received_by uuid DEFAULT NULL::uuid, _start_date date DEFAULT NULL::date, _reassign_member_trainer boolean DEFAULT true, _allow_duplicate boolean DEFAULT false)
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

  -- Duplicate-sale guard: block a second package while one is live or awaiting payment,
  -- unless the caller explicitly confirms an additional package.
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
    _gst_rate, _payment_method, _payment_source, _idempotency_key, _received_by, _start_date
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