CREATE OR REPLACE FUNCTION public.purchase_custom_benefit_credits(
  p_member_id uuid,
  p_membership_id uuid,
  p_branch_id uuid,
  p_benefit_type_id uuid,
  p_quantity integer,
  p_amount numeric,
  p_is_gst_invoice boolean DEFAULT false,
  p_gst_rate numeric DEFAULT 5,
  p_validity_days integer DEFAULT NULL,
  p_sync_membership boolean DEFAULT false,
  p_payment_method text DEFAULT 'cash',
  p_package_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_bt RECORD;
  v_ms RECORD;
  v_enum text;
  v_expires timestamptz;
  v_rate numeric;
  v_subtotal numeric; v_tax numeric; v_total numeric;
  v_invoice_id uuid; v_credit_id uuid; v_settle jsonb; v_hsn text;
  v_existing uuid;
BEGIN
  IF public.rpc_guard_applies('purchase_custom_benefit_credits') THEN
    IF NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::public.app_role[]) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only branch staff can sell add-ons');
    END IF;
    IF NOT public.has_any_role(v_uid, ARRAY['owner','admin']::public.app_role[])
       AND p_branch_id IS DISTINCT FROM public.get_user_branch(v_uid)
       AND NOT (p_branch_id IN (SELECT public.managed_branch_ids(v_uid))) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not allowed for this branch');
    END IF;
  END IF;

  IF COALESCE(p_quantity,0) < 1 OR p_quantity > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessions must be between 1 and 500');
  END IF;
  IF COALESCE(p_amount,-1) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be zero or more');
  END IF;
  IF COALESCE(p_payment_method,'') NOT IN ('cash','card','bank_transfer','wallet','upi','cheque','other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unsupported payment method');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT invoice_id INTO v_existing FROM public.payments WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'invoice_id', v_existing, 'duplicate', true);
    END IF;
  END IF;

  SELECT id, name, code INTO v_bt FROM public.benefit_types WHERE id = p_benefit_type_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Facility not found'); END IF;

  SELECT id, end_date, status INTO v_ms FROM public.memberships
   WHERE id = p_membership_id AND member_id = p_member_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Active membership required'); END IF;

  IF p_sync_membership THEN
    v_expires := (v_ms.end_date::timestamp + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Kolkata';
  ELSE
    v_expires := now() + make_interval(days => GREATEST(COALESCE(p_validity_days,30),1));
  END IF;

  -- Map to legacy enum used by older readers
  v_enum := CASE
    WHEN v_bt.code ILIKE 'sauna%' THEN 'sauna_access'
    WHEN v_bt.code ILIKE 'steam%' THEN 'steam_access'
    WHEN v_bt.code ILIKE 'ice%' THEN 'ice_bath'
    WHEN v_bt.code ILIKE '%scan%' THEN 'body_scan'
    ELSE 'other' END;
  IF p_package_id IS NOT NULL THEN
    SELECT benefit_type::text, hsn_code INTO v_enum, v_hsn FROM public.benefit_packages WHERE id = p_package_id;
  END IF;

  v_rate := CASE WHEN p_is_gst_invoice THEN GREATEST(COALESCE(p_gst_rate,0),0) ELSE 0 END;
  v_total := ROUND(p_amount, 2);
  v_subtotal := ROUND(v_total / (1 + v_rate/100.0), 2);
  v_tax := ROUND(v_total - v_subtotal, 2);

  PERFORM set_config('app.trusted_invoice', 'true', true);

  INSERT INTO public.invoices (branch_id, member_id, subtotal, tax_amount, total_amount, amount_paid,
    status, due_date, payment_due_date, invoice_type, is_gst_invoice, gst_rate, notes)
  VALUES (p_branch_id, p_member_id, v_subtotal, v_tax, v_total, 0, 'pending', CURRENT_DATE, CURRENT_DATE,
    'benefit_addon', v_rate > 0, v_rate,
    format('Add-on: %s × %s', p_quantity, COALESCE(NULLIF(p_label,''), v_bt.name)))
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
    hsn_code, reference_type, reference_id)
  VALUES (v_invoice_id, format('Add-on: %s (%s sessions)', COALESCE(NULLIF(p_label,''), v_bt.name), p_quantity),
    v_subtotal, 1, v_rate, v_tax, v_subtotal, COALESCE(v_hsn,'999723'),
    CASE WHEN p_package_id IS NULL THEN 'benefit_type' ELSE 'benefit_package' END,
    COALESCE(p_package_id, p_benefit_type_id));

  INSERT INTO public.member_benefit_credits (member_id, membership_id, benefit_type, benefit_type_id, package_id,
    credits_total, credits_remaining, expires_at, invoice_id)
  VALUES (p_member_id, p_membership_id, v_enum::public.benefit_type, p_benefit_type_id, p_package_id,
    p_quantity, p_quantity, v_expires, v_invoice_id)
  RETURNING id INTO v_credit_id;

  IF v_total > 0 THEN
    v_settle := public.settle_payment(p_branch_id, v_invoice_id, p_member_id, v_total, p_payment_method,
      NULL, NULL, v_uid, NULL, 'benefit_addon', p_idempotency_key, NULL, NULL,
      jsonb_build_object('custom', true, 'benefit_type_id', p_benefit_type_id, 'credit_id', v_credit_id, 'quantity', p_quantity));
    IF COALESCE((v_settle->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'settle_payment_failed: %', COALESCE(v_settle->>'error','unknown');
    END IF;
  ELSE
    UPDATE public.invoices SET status = 'paid' WHERE id = v_invoice_id;
  END IF;

  PERFORM set_config('app.trusted_invoice', 'false', true);

  INSERT INTO public.audit_logs (action, table_name, record_id, user_id, branch_id, new_data)
  VALUES ('CUSTOM_ADDON_SOLD', 'member_benefit_credits', v_credit_id, v_uid, p_branch_id,
    jsonb_build_object('member_id', p_member_id, 'invoice_id', v_invoice_id, 'quantity', p_quantity,
      'amount', v_total, 'gst', v_rate > 0, 'gst_rate', v_rate, 'expires_at', v_expires, 'payment_method', p_payment_method));

  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'credit_id', v_credit_id,
    'amount', v_total, 'subtotal', v_subtotal, 'tax_amount', v_tax, 'expires_at', v_expires);
END $$;

REVOKE EXECUTE ON FUNCTION public.purchase_custom_benefit_credits(uuid,uuid,uuid,uuid,integer,numeric,boolean,numeric,integer,boolean,text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_custom_benefit_credits(uuid,uuid,uuid,uuid,integer,numeric,boolean,numeric,integer,boolean,text,uuid,text,text) TO authenticated, service_role;