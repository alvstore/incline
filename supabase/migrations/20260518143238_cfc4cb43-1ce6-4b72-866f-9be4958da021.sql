
-- Schema columns
ALTER TABLE public.member_pt_packages
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_pending_at timestamptz,
  ADD COLUMN IF NOT EXISTS gst_rate numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_pt_packages_idempotency_key_unique') THEN
    ALTER TABLE public.member_pt_packages
      ADD CONSTRAINT member_pt_packages_idempotency_key_unique UNIQUE (idempotency_key);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_member_pt_packages_pending_payment
  ON public.member_pt_packages (expires_pending_at)
  WHERE status = 'pending_payment';

CREATE INDEX IF NOT EXISTS idx_member_pt_packages_invoice
  ON public.member_pt_packages (invoice_id);

-- Drop legacy overloads
DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid, uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, text, text, uuid, numeric, numeric);

-- Canonical purchase RPC
CREATE OR REPLACE FUNCTION public.purchase_pt_package(
  _member_id uuid,
  _package_id uuid,
  _trainer_id uuid,
  _branch_id uuid,
  _price_paid numeric,
  _gst_rate numeric DEFAULT 5,
  _payment_method text DEFAULT 'cash',
  _payment_source text DEFAULT 'in_person',
  _idempotency_key text DEFAULT NULL,
  _received_by uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  i integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF _gst_rate IS NULL OR _gst_rate NOT IN (0, 5) THEN
    RETURN jsonb_build_object('success', false, 'error', 'GST rate must be 0 or 5 for PT');
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
      RETURN jsonb_build_object(
        'success', true, 'idempotent', true,
        'member_package_id', _existing_id, 'invoice_id', _invoice_id
      );
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

  INSERT INTO public.member_pt_packages (
    member_id, package_id, trainer_id, branch_id,
    sessions_total, sessions_remaining, price_paid,
    subtotal, tax_amount, gst_rate,
    start_date, expiry_date,
    status, payment_status,
    idempotency_key, expires_pending_at, package_type
  ) VALUES (
    _member_id, _package_id, _trainer_id, _branch_id,
    CASE WHEN _package.package_type = 'duration_based' THEN 0 ELSE _package.total_sessions END,
    CASE WHEN _package.package_type = 'duration_based' THEN 0 ELSE _package.total_sessions END,
    _price_paid,
    _subtotal, _tax, _gst_rate,
    CURRENT_DATE,
    CASE WHEN _package.package_type = 'duration_based'
         THEN CURRENT_DATE + (_package.duration_months * 30)
         ELSE CURRENT_DATE + _package.validity_days END,
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
    invoice_id, description, unit_price, quantity, total_amount,
    reference_type, reference_id
  ) VALUES (
    _invoice_id, 'PT Package - ' || _package.name,
    _price_paid, 1, _price_paid,
    'pt_package', _member_package_id
  );

  _commission_amount := round(_subtotal * (_commission_rate / 100.0), 2);

  IF _trainer_id IS NOT NULL THEN
    IF _package.package_type = 'duration_based' AND _package.duration_months > 0 THEN
      _monthly_commission := round(_commission_amount / _package.duration_months, 2);
      FOR i IN 0..(_package.duration_months - 1) LOOP
        INSERT INTO public.trainer_commissions (
          trainer_id, pt_package_id, commission_type, amount, percentage,
          status, kind, release_date, notes
        ) VALUES (
          _trainer_id, _member_package_id, 'package_sale',
          _monthly_commission, _commission_rate,
          'pending', 'earned_unconfirmed',
          CURRENT_DATE + (i * 30),
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
        'pending', 'earned_unconfirmed', CURRENT_DATE,
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
    'commission_base', _subtotal,
    'commission_amount', _commission_amount,
    'status', 'pending_payment',
    'payment_source', _payment_source
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.purchase_pt_package(uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid) TO authenticated, service_role;

-- activate_pt_package
CREATE OR REPLACE FUNCTION public.activate_pt_package(
  _member_package_id uuid,
  _payment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _row record;
BEGIN
  SELECT * INTO _row FROM public.member_pt_packages WHERE id = _member_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  IF _row.status = 'active' AND _row.payment_status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_active', true);
  END IF;

  IF _row.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not pending', 'status', _row.status);
  END IF;

  UPDATE public.member_pt_packages
  SET status = 'active'::pt_package_status,
      payment_status = 'paid',
      expires_pending_at = NULL
  WHERE id = _member_package_id;

  UPDATE public.trainer_commissions
  SET kind = 'earned',
      source_payment_id = COALESCE(source_payment_id, _payment_id),
      notes = NULL
  WHERE pt_package_id = _member_package_id AND kind = 'earned_unconfirmed';

  IF _row.trainer_id IS NOT NULL THEN
    UPDATE public.members
    SET assigned_trainer_id = _row.trainer_id
    WHERE id = _row.member_id AND assigned_trainer_id IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true, 'member_package_id', _member_package_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_pt_package(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_pt_package(uuid, uuid) TO service_role;

-- cancel_pending_pt_package
CREATE OR REPLACE FUNCTION public.cancel_pending_pt_package(
  _member_package_id uuid,
  _reason text DEFAULT 'manual_cancel'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _row record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO _row FROM public.member_pt_packages WHERE id = _member_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  IF _row.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only pending packages can be reversed', 'status', _row.status);
  END IF;

  UPDATE public.member_pt_packages
  SET status = 'reversed'::pt_package_status,
      payment_status = 'refunded',
      expires_pending_at = NULL
  WHERE id = _member_package_id;

  IF _row.invoice_id IS NOT NULL THEN
    UPDATE public.invoices
    SET status = 'cancelled'::invoice_status,
        notes = COALESCE(notes, '') || ' | reversed: ' || _reason
    WHERE id = _row.invoice_id AND status IN ('pending'::invoice_status, 'partial'::invoice_status);
  END IF;

  DELETE FROM public.trainer_commissions
  WHERE pt_package_id = _member_package_id AND kind = 'earned_unconfirmed';

  RETURN jsonb_build_object('success', true, 'member_package_id', _member_package_id, 'reason', _reason);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_pending_pt_package(uuid, text) TO authenticated, service_role;

-- reverse_stale_pt_purchases
CREATE OR REPLACE FUNCTION public.reverse_stale_pt_purchases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _row record;
  _count int := 0;
  _result jsonb;
BEGIN
  FOR _row IN
    SELECT id FROM public.member_pt_packages
    WHERE status = 'pending_payment'
      AND expires_pending_at IS NOT NULL
      AND expires_pending_at < now()
    LIMIT 200
  LOOP
    BEGIN
      _result := public.cancel_pending_pt_package(_row.id, 'payment_timeout');
      IF COALESCE((_result->>'success')::boolean, false) THEN
        _count := _count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_error_event(
        'error', 'reverse_stale_pt_purchases', SQLERRM,
        'reverse_stale_pt_purchases', NULL, 'member_pt_packages',
        NULL, NULL, NULL, NULL, NULL,
        jsonb_build_object('member_package_id', _row.id)
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reversed_count', _count);
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_stale_pt_purchases() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_stale_pt_purchases() TO service_role, authenticated;

-- Payment trigger: activate PT package when its invoice is fully paid
CREATE OR REPLACE FUNCTION public.trg_payment_activate_pt_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _mp_id uuid;
  _inv_total numeric;
  _inv_paid numeric;
BEGIN
  IF NEW.status <> 'completed'::payment_status THEN RETURN NEW; END IF;
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;

  SELECT mp.id INTO _mp_id
  FROM public.member_pt_packages mp
  WHERE mp.invoice_id = NEW.invoice_id AND mp.status = 'pending_payment'
  LIMIT 1;

  IF _mp_id IS NULL THEN RETURN NEW; END IF;

  SELECT total_amount, amount_paid INTO _inv_total, _inv_paid
  FROM public.invoices WHERE id = NEW.invoice_id;

  IF _inv_paid IS NOT NULL AND _inv_total IS NOT NULL AND _inv_paid >= _inv_total THEN
    PERFORM public.activate_pt_package(_mp_id, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payments_activate_pt_package_trg ON public.payments;
CREATE TRIGGER payments_activate_pt_package_trg
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.trg_payment_activate_pt_package();
