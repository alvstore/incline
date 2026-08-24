DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid, date);

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
  _received_by uuid DEFAULT NULL,
  _start_date date DEFAULT NULL,
  _reassign_member_trainer boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
  _prev_trainer uuid;
BEGIN
  IF _gst_rate IS NULL OR _gst_rate NOT IN (0, 5) THEN
    RAISE EXCEPTION 'pt_gst_must_be_0_or_5'
      USING HINT = 'Personal training GST is 5% (inclusive) or 0% for exempt sales.';
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
$$;

GRANT EXECUTE ON FUNCTION public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid, date, boolean) TO service_role;