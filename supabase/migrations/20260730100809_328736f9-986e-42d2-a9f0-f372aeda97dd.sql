-- 1. Restore the real PT purchase implementation (was self-recursive)
CREATE OR REPLACE FUNCTION public._purchase_pt_package_impl(_member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric, _gst_rate numeric DEFAULT 5, _payment_method text DEFAULT 'cash'::text, _payment_source text DEFAULT 'in_person'::text, _idempotency_key text DEFAULT NULL::text, _received_by uuid DEFAULT auth.uid())
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
    CASE WHEN _package.package_type = 'monthly'::pt_package_type THEN 0 ELSE _package.total_sessions END,
    CASE WHEN _package.package_type = 'monthly'::pt_package_type THEN 0 ELSE _package.total_sessions END,
    _price_paid,
    _subtotal, _tax, _gst_rate,
    CURRENT_DATE,
    CASE WHEN _package.package_type = 'monthly'::pt_package_type
         THEN CURRENT_DATE + (COALESCE(_package.duration_months, 1) * 30)
         ELSE CURRENT_DATE + COALESCE(_package.validity_days, 30) END,
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
    tax_rate, tax_amount, total_amount,
    reference_type, reference_id
  ) VALUES (
    _invoice_id, 'PT Package - ' || _package.name,
    _subtotal, 1, 5, _tax, _price_paid,
    'pt_package', _member_package_id
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

-- 2. Grant the capability the member-onboarding storage policy requires
INSERT INTO public.role_capabilities (role, capability)
VALUES
  ('owner'::app_role,   'view_member_documents'),
  ('admin'::app_role,   'view_member_documents'),
  ('manager'::app_role, 'view_member_documents'),
  ('staff'::app_role,   'view_member_documents')
ON CONFLICT DO NOTHING;

-- 3. Branch-scope contract signature access (security finding)
DROP POLICY IF EXISTS "admin_view_signatures" ON public.contract_signatures;
DROP POLICY IF EXISTS "admin_insert_signatures" ON public.contract_signatures;
DROP POLICY IF EXISTS "admin_all_csr" ON public.contract_signature_requests;

CREATE POLICY "signatures_select_branch_scoped"
ON public.contract_signatures FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_signatures.contract_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

CREATE POLICY "signatures_insert_branch_scoped"
ON public.contract_signatures FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_signatures.contract_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

CREATE POLICY "csr_all_branch_scoped"
ON public.contract_signature_requests FOR ALL TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_signature_requests.contract_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_signature_requests.contract_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);