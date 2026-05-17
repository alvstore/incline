
-- 1. Add nullable subtotal/tax_amount columns (backward compatible)
ALTER TABLE public.member_pt_packages
  ADD COLUMN IF NOT EXISTS subtotal numeric,
  ADD COLUMN IF NOT EXISTS tax_amount numeric;

COMMENT ON COLUMN public.member_pt_packages.subtotal IS
  'Pre-GST amount paid for this PT package. Trainer commissions are computed on this base.';
COMMENT ON COLUMN public.member_pt_packages.tax_amount IS
  'GST portion of the price_paid. price_paid = subtotal + tax_amount when both are set.';

-- 2. Drop the existing 8-arg purchase_pt_package overload so we can extend its signature
DROP FUNCTION IF EXISTS public.purchase_pt_package(
  uuid, uuid, uuid, uuid, numeric, text, text, uuid
);

-- 3. Recreate with two new optional params: _subtotal, _tax_amount
CREATE OR REPLACE FUNCTION public.purchase_pt_package(
  _member_id uuid,
  _package_id uuid,
  _trainer_id uuid,
  _branch_id uuid,
  _price_paid numeric,
  _payment_method text DEFAULT 'cash',
  _idempotency_key text DEFAULT NULL,
  _received_by uuid DEFAULT auth.uid(),
  _subtotal numeric DEFAULT NULL,
  _tax_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _package RECORD;
  _member_package_id uuid;
  _commission_base numeric;
  _commission_amount numeric;
  _monthly_commission numeric;
  _commission_rate numeric;
  _invoice_id uuid;
  _settle_result jsonb;
  i INTEGER;
BEGIN
  SELECT * INTO _package FROM public.pt_packages WHERE id = _package_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  SELECT pt_share_percentage INTO _commission_rate FROM public.trainers WHERE id = _trainer_id;
  _commission_rate := COALESCE(_commission_rate, 20);

  INSERT INTO public.member_pt_packages (
    member_id, package_id, trainer_id, branch_id,
    sessions_total, sessions_remaining, price_paid,
    subtotal, tax_amount,
    start_date, expiry_date, status
  ) VALUES (
    _member_id, _package_id, _trainer_id, _branch_id,
    CASE WHEN _package.package_type = 'duration_based' THEN 0 ELSE _package.total_sessions END,
    CASE WHEN _package.package_type = 'duration_based' THEN 0 ELSE _package.total_sessions END,
    _price_paid,
    _subtotal, _tax_amount,
    CURRENT_DATE,
    CASE WHEN _package.package_type = 'duration_based' THEN CURRENT_DATE + (_package.duration_months * 30)
         ELSE CURRENT_DATE + _package.validity_days END,
    'pending'
  ) RETURNING id INTO _member_package_id;

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, total_amount, amount_paid,
    status, due_date, invoice_type
  ) VALUES (
    _branch_id, _member_id,
    COALESCE(_subtotal, _price_paid),
    _price_paid, 0,
    'pending'::public.invoice_status, CURRENT_DATE, 'pt_package'
  ) RETURNING id INTO _invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, unit_price, quantity, total_amount,
    reference_type, reference_id
  ) VALUES (
    _invoice_id,
    'PT Package - ' || _package.name,
    _price_paid, 1, _price_paid,
    'pt_package', _member_package_id
  );

  _settle_result := public.settle_payment(
    _branch_id,
    _invoice_id,
    _member_id,
    _price_paid,
    _payment_method,
    NULL, NULL, _received_by, NULL,
    'pt_purchase',
    COALESCE(_idempotency_key, _member_package_id::text),
    NULL, NULL,
    jsonb_build_object('member_pt_package_id', _member_package_id, 'trainer_id', _trainer_id)
  );

  IF COALESCE((_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
    DELETE FROM public.invoices WHERE id = _invoice_id;
    DELETE FROM public.member_pt_packages WHERE id = _member_package_id;
    RETURN _settle_result;
  END IF;

  UPDATE public.member_pt_packages SET status = 'active' WHERE id = _member_package_id;

  -- Commission base = pre-GST subtotal when available; fall back to price_paid
  _commission_base := COALESCE(_subtotal, _price_paid);
  _commission_amount := _commission_base * (_commission_rate / 100.0);

  IF _trainer_id IS NOT NULL THEN
    IF _package.package_type = 'duration_based' AND _package.duration_months > 0 THEN
      _monthly_commission := ROUND(_commission_amount / _package.duration_months, 2);
      FOR i IN 0..(_package.duration_months - 1) LOOP
        INSERT INTO public.trainer_commissions (
          trainer_id, pt_package_id, commission_type, amount, percentage, status, release_date
        ) VALUES (
          _trainer_id, _member_package_id, 'package_sale',
          _monthly_commission, _commission_rate, 'pending',
          CURRENT_DATE + (i * 30)
        );
      END LOOP;
    ELSE
      INSERT INTO public.trainer_commissions (
        trainer_id, pt_package_id, commission_type, amount, percentage, release_date
      ) VALUES (
        _trainer_id, _member_package_id, 'package_sale',
        _commission_amount, _commission_rate, CURRENT_DATE
      );
    END IF;

    UPDATE public.members SET assigned_trainer_id = _trainer_id
    WHERE id = _member_id AND assigned_trainer_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'member_package_id', _member_package_id,
    'invoice_id', _invoice_id,
    'subtotal', COALESCE(_subtotal, _price_paid),
    'tax_amount', COALESCE(_tax_amount, 0),
    'commission_base', _commission_base
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.purchase_pt_package(
  uuid, uuid, uuid, uuid, numeric, text, text, uuid, numeric, numeric
) TO authenticated;

COMMENT ON FUNCTION public.purchase_pt_package(
  uuid, uuid, uuid, uuid, numeric, text, text, uuid, numeric, numeric
) IS 'Trainer-direct PT purchase. Commission computed on COALESCE(_subtotal, _price_paid) so trainers are never paid on GST.';
