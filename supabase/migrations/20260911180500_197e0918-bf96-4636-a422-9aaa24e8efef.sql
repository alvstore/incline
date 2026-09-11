ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS online_convenience_fee_pct numeric(5,2) NOT NULL DEFAULT 2.00;

CREATE OR REPLACE FUNCTION public.online_convenience_pct(_branch_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE((SELECT bs.online_convenience_fee_pct
                            FROM public.branch_settings bs
                            WHERE bs.branch_id = _branch_id), 0), 0)
$$;

GRANT EXECUTE ON FUNCTION public.online_convenience_pct(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purchase_benefit_credits(
  p_member_id uuid,
  p_membership_id uuid,
  p_package_id uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT 'cash'::text,
  p_idempotency_key text DEFAULT NULL::text,
  p_received_by uuid DEFAULT auth.uid(),
  p_defer_settlement boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pkg RECORD;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_credit_id uuid;
  v_settle_result jsonb;
  v_expires_at timestamptz;
  v_rate numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_fee_pct numeric := 0;
  v_fee numeric := 0;
BEGIN
  -- Never let a non-payment placeholder ("pending") silently settle as cash.
  IF NOT p_defer_settlement
     AND COALESCE(p_payment_method, '') NOT IN ('cash','card','bank_transfer','wallet','upi','cheque','other') THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Unsupported payment method "%s" — use an online payment or a real settlement method.', p_payment_method));
  END IF;

  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  v_branch_id := COALESCE(p_branch_id, v_pkg.branch_id);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Branch missing');
  END IF;

  v_expires_at := now() + (v_pkg.validity_days || ' days')::interval;

  v_rate := COALESCE(v_pkg.tax_rate, 0) / 100.0;
  IF COALESCE(v_pkg.tax_inclusive, true) THEN
    v_total    := ROUND(v_pkg.price::numeric, 2);
    v_subtotal := ROUND(v_total / (1 + v_rate), 2);
    v_tax      := ROUND(v_total - v_subtotal, 2);
  ELSE
    v_subtotal := ROUND(v_pkg.price::numeric, 2);
    v_tax      := ROUND(v_subtotal * v_rate, 2);
    v_total    := ROUND(v_subtotal + v_tax, 2);
  END IF;

  -- Online payments carry a branch-configured convenience charge as its own line.
  IF p_defer_settlement THEN
    v_fee_pct := public.online_convenience_pct(v_branch_id);
    v_fee := ROUND(v_total * v_fee_pct / 100.0, 2);
  END IF;

  -- Trusted server routine: totals computed here must survive the member guards.
  PERFORM set_config('app.trusted_invoice', 'true', true);

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, tax_amount, total_amount, amount_paid,
    status, due_date, payment_due_date, invoice_type, is_gst_invoice, gst_rate, notes
  ) VALUES (
    v_branch_id, p_member_id, v_subtotal + v_fee, v_tax, v_total + v_fee, 0,
    'pending'::public.invoice_status, CURRENT_DATE, CURRENT_DATE, 'benefit_addon',
    COALESCE(v_pkg.tax_rate, 0) > 0, COALESCE(v_pkg.tax_rate, 0),
    CASE WHEN p_defer_settlement
      THEN 'benefit_addon:' || p_package_id::text || ':' || COALESCE(p_membership_id::text, '')
      ELSE NULL END
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
    hsn_code, reference_type, reference_id
  ) VALUES (
    v_invoice_id,
    format('Add-on: %s (%s credits)', v_pkg.name, v_pkg.quantity),
    v_subtotal, 1, COALESCE(v_pkg.tax_rate, 0), v_tax, v_subtotal,
    v_pkg.hsn_code, 'benefit_package', p_package_id
  );

  IF v_fee > 0 THEN
    INSERT INTO public.invoice_items (
      invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
      reference_type, reference_id
    ) VALUES (
      v_invoice_id,
      format('Online payment convenience charge (%s%%)', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_fee_pct::text))),
      v_fee, 1, 0, 0, v_fee,
      'convenience_fee', p_package_id
    );
  END IF;

  IF p_defer_settlement THEN
    PERFORM set_config('app.trusted_invoice', 'false', true);
    RETURN jsonb_build_object(
      'success', true,
      'deferred', true,
      'invoice_id', v_invoice_id,
      'amount', v_total + v_fee,
      'subtotal', v_subtotal,
      'tax_amount', v_tax,
      'convenience_fee', v_fee,
      'convenience_pct', v_fee_pct
    );
  END IF;

  BEGIN
    INSERT INTO public.member_benefit_credits (
      member_id, membership_id, benefit_type, package_id,
      credits_total, credits_remaining, expires_at, invoice_id
    ) VALUES (
      p_member_id, p_membership_id, v_pkg.benefit_type, p_package_id,
      v_pkg.quantity, v_pkg.quantity, v_expires_at, v_invoice_id
    ) RETURNING id INTO v_credit_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'benefit_credits_insert_failed: %', SQLERRM;
  END;

  v_settle_result := public.settle_payment(
    v_branch_id,
    v_invoice_id,
    p_member_id,
    v_total,
    p_payment_method,
    NULL, NULL, p_received_by, NULL,
    'benefit_addon',
    p_idempotency_key,
    NULL, NULL,
    jsonb_build_object('package_id', p_package_id, 'membership_id', p_membership_id, 'credit_id', v_credit_id)
  );

  PERFORM set_config('app.trusted_invoice', 'false', true);

  IF COALESCE((v_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'settle_payment_failed: %', COALESCE(v_settle_result->>'error','unknown');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'credit_id', v_credit_id,
    'invoice_id', v_invoice_id,
    'amount', v_total,
    'subtotal', v_subtotal,
    'tax_amount', v_tax
  );
END;
$function$;

-- Abandoned online checkout must leave nothing behind.
CREATE OR REPLACE FUNCTION public.abandon_online_addon_invoice(_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
BEGIN
  SELECT i.id, i.status, i.amount_paid, i.invoice_type, i.member_id
    INTO v_inv
  FROM public.invoices i
  WHERE i.id = _invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF v_inv.invoice_type <> 'benefit_addon'
     OR COALESCE(v_inv.amount_paid, 0) > 0
     OR v_inv.status <> 'pending'::public.invoice_status THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an unpaid add-on invoice can be abandoned');
  END IF;

  -- Only the member who owns it, or staff who can manage billing.
  IF NOT (
    EXISTS (SELECT 1 FROM public.members m WHERE m.id = v_inv.member_id AND m.user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not allowed');
  END IF;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.abandon_online_addon_invoice(uuid) TO authenticated, service_role;