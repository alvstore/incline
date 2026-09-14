
-- 1. Backfill missing benefit_type_id from the purchased package
UPDATE public.member_benefit_credits mbc
   SET benefit_type_id = bp.benefit_type_id, updated_at = now()
  FROM public.benefit_packages bp
 WHERE mbc.package_id = bp.id
   AND mbc.benefit_type_id IS NULL
   AND bp.benefit_type_id IS NOT NULL;

-- 2. purchase_benefit_credits: persist benefit_type_id
CREATE OR REPLACE FUNCTION public.purchase_benefit_credits(p_member_id uuid, p_membership_id uuid, p_package_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_idempotency_key text DEFAULT NULL::text, p_received_by uuid DEFAULT auth.uid(), p_defer_settlement boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  IF p_defer_settlement THEN
    v_fee_pct := public.online_convenience_pct(v_branch_id);
    v_fee := ROUND(v_total * v_fee_pct / 100.0, 2);
  END IF;

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
      'success', true, 'deferred', true, 'invoice_id', v_invoice_id,
      'amount', v_total + v_fee, 'subtotal', v_subtotal, 'tax_amount', v_tax,
      'convenience_fee', v_fee, 'convenience_pct', v_fee_pct
    );
  END IF;

  BEGIN
    INSERT INTO public.member_benefit_credits (
      member_id, membership_id, benefit_type, benefit_type_id, package_id,
      credits_total, credits_remaining, expires_at, invoice_id
    ) VALUES (
      p_member_id, p_membership_id, v_pkg.benefit_type, v_pkg.benefit_type_id, p_package_id,
      v_pkg.quantity, v_pkg.quantity, v_expires_at, v_invoice_id
    ) RETURNING id INTO v_credit_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'benefit_credits_insert_failed: %', SQLERRM;
  END;

  v_settle_result := public.settle_payment(
    v_branch_id, v_invoice_id, p_member_id, v_total, p_payment_method,
    NULL, NULL, p_received_by, NULL, 'benefit_addon', p_idempotency_key, NULL, NULL,
    jsonb_build_object('package_id', p_package_id, 'membership_id', p_membership_id, 'credit_id', v_credit_id)
  );

  PERFORM set_config('app.trusted_invoice', 'false', true);

  IF COALESCE((v_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'settle_payment_failed: %', COALESCE(v_settle_result->>'error','unknown');
  END IF;

  RETURN jsonb_build_object('success', true, 'credit_id', v_credit_id, 'invoice_id', v_invoice_id,
    'amount', v_total, 'subtotal', v_subtotal, 'tax_amount', v_tax);
END;
$function$;

-- 3. activate_benefit_credits_for_invoice: persist benefit_type_id
CREATE OR REPLACE FUNCTION public.activate_benefit_credits_for_invoice(_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv RECORD;
  v_item RECORD;
  v_pkg RECORD;
  v_membership_id uuid;
  v_credit_id uuid;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_benefit_credits WHERE invoice_id = _invoice_id) THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  SELECT * INTO v_item
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id AND reference_type = 'benefit_package'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No benefit package line item');
  END IF;

  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = v_item.reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  SELECT id INTO v_membership_id
  FROM public.memberships
  WHERE member_id = v_inv.member_id AND status = 'active'
  ORDER BY end_date DESC LIMIT 1;

  INSERT INTO public.member_benefit_credits (
    member_id, membership_id, benefit_type, benefit_type_id, package_id,
    credits_total, credits_remaining, expires_at, invoice_id
  ) VALUES (
    v_inv.member_id, v_membership_id, v_pkg.benefit_type, v_pkg.benefit_type_id, v_pkg.id,
    v_pkg.quantity, v_pkg.quantity,
    now() + (v_pkg.validity_days || ' days')::interval, _invoice_id
  ) RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object('success', true, 'credit_id', v_credit_id);
END;
$function$;

-- 4. Quota: also recognise legacy credits linked only by benefit enum
CREATE OR REPLACE FUNCTION public.howbody_scan_quota(_member_id uuid, _kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := CASE WHEN _kind = 'posture' THEN 'howbody_posture' ELSE '3d_body_scanning' END;
  v_enum public.benefit_type := CASE WHEN _kind = 'posture' THEN 'posture_scan'::public.benefit_type ELSE 'body_scan'::public.benefit_type END;
  v_branch uuid;
  v_benefit_type_id uuid;
  v_plan_id uuid;
  v_plan_limit int := 0;
  v_plan_freq text;
  v_used_this_period int := 0;
  v_used_this_month int := 0;
  v_addon_remaining int := 0;
  v_period_start timestamptz;
  v_month_start timestamptz := date_trunc('month', now());
  v_plan_remaining int := 0;
BEGIN
  SELECT m.branch_id INTO v_branch FROM public.members m WHERE m.id = _member_id;

  SELECT mp.id INTO v_plan_id
  FROM public.memberships mb
  JOIN public.membership_plans mp ON mp.id = mb.plan_id
  WHERE mb.member_id = _member_id
    AND mb.status = 'active'
    AND mb.end_date >= CURRENT_DATE
  ORDER BY mb.end_date DESC
  LIMIT 1;

  SELECT bt.id INTO v_benefit_type_id
    FROM public.benefit_types bt
   WHERE bt.code = v_code AND bt.branch_id = v_branch
   LIMIT 1;

  IF v_plan_id IS NOT NULL AND v_benefit_type_id IS NOT NULL THEN
    SELECT COALESCE(SUM(pb.limit_count), 0), MIN(pb.frequency)
      INTO v_plan_limit, v_plan_freq
      FROM public.plan_benefits pb
     WHERE pb.plan_id = v_plan_id
       AND pb.benefit_type_id = v_benefit_type_id;
  END IF;

  v_period_start := CASE
    WHEN v_plan_freq = 'monthly' THEN v_month_start
    WHEN v_plan_freq = 'weekly' THEN date_trunc('week', now())
    WHEN v_plan_freq = 'daily' THEN date_trunc('day', now())
    ELSE NULL
  END;

  IF _kind = 'posture' THEN
    SELECT COUNT(*) INTO v_used_this_period
      FROM public.howbody_posture_reports
     WHERE member_id = _member_id
       AND (v_period_start IS NULL OR created_at >= v_period_start);
    SELECT COUNT(*) INTO v_used_this_month
      FROM public.howbody_posture_reports
     WHERE member_id = _member_id AND created_at >= v_month_start;
  ELSE
    SELECT COUNT(*) INTO v_used_this_period
      FROM public.howbody_body_reports
     WHERE member_id = _member_id
       AND (v_period_start IS NULL OR created_at >= v_period_start);
    SELECT COUNT(*) INTO v_used_this_month
      FROM public.howbody_body_reports
     WHERE member_id = _member_id AND created_at >= v_month_start;
  END IF;

  SELECT COALESCE(SUM(mbc.credits_remaining), 0) INTO v_addon_remaining
    FROM public.member_benefit_credits mbc
   WHERE mbc.member_id = _member_id
     AND mbc.credits_remaining > 0
     AND (mbc.expires_at IS NULL OR mbc.expires_at > now())
     AND (
       (v_benefit_type_id IS NOT NULL AND mbc.benefit_type_id = v_benefit_type_id)
       OR (mbc.benefit_type_id IS NULL AND mbc.benefit_type = v_enum)
     );

  v_plan_remaining := GREATEST(0, COALESCE(v_plan_limit,0) - v_used_this_period);

  RETURN jsonb_build_object(
    'kind', _kind,
    'benefit_code', v_code,
    'plan_limit', COALESCE(v_plan_limit, 0),
    'plan_frequency', v_plan_freq,
    'used_this_period', v_used_this_period,
    'used_this_month', v_used_this_month,
    'plan_remaining', v_plan_remaining,
    'addon_remaining', v_addon_remaining,
    'allowed', (v_plan_remaining > 0) OR (v_addon_remaining > 0),
    'reason', CASE
      WHEN COALESCE(v_plan_limit,0) = 0 AND v_addon_remaining = 0 THEN 'plan_no_scan'
      WHEN v_plan_remaining = 0 AND v_addon_remaining = 0 THEN 'period_limit'
      ELSE 'ok'
    END
  );
END;
$function$;

-- 5. Consumption: match the same credit selection logic
CREATE OR REPLACE FUNCTION public.howbody_consume_scan(_member_id uuid, _kind text, _data_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.howbody_scan_consumptions%ROWTYPE;
  v_quota jsonb;
  v_credit_id uuid;
  v_code text := CASE WHEN _kind = 'posture' THEN 'howbody_posture' ELSE '3d_body_scanning' END;
  v_enum public.benefit_type := CASE WHEN _kind = 'posture' THEN 'posture_scan'::public.benefit_type ELSE 'body_scan'::public.benefit_type END;
  v_source text;
BEGIN
  IF _data_key IS NULL OR length(trim(_data_key)) = 0 THEN
    RAISE EXCEPTION 'data_key is required';
  END IF;

  SELECT * INTO v_existing
    FROM public.howbody_scan_consumptions
   WHERE data_key = _data_key
   FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object('consumed', false, 'duplicate', true, 'source', v_existing.source);
  END IF;

  v_quota := public.howbody_scan_quota(_member_id, _kind);

  IF COALESCE((v_quota->>'plan_remaining')::int, 0) > 0 THEN
    v_source := 'plan';
  ELSE
    SELECT mbc.id INTO v_credit_id
      FROM public.member_benefit_credits mbc
      LEFT JOIN public.benefit_types bt ON bt.id = mbc.benefit_type_id
     WHERE mbc.member_id = _member_id
       AND mbc.credits_remaining > 0
       AND (mbc.expires_at IS NULL OR mbc.expires_at > now())
       AND (bt.code = v_code OR (mbc.benefit_type_id IS NULL AND mbc.benefit_type = v_enum))
     ORDER BY COALESCE(mbc.expires_at, 'infinity'::timestamptz) ASC, mbc.purchased_at ASC
     LIMIT 1
     FOR UPDATE OF mbc;

    IF v_credit_id IS NOT NULL THEN
      UPDATE public.member_benefit_credits
         SET credits_remaining = credits_remaining - 1,
             updated_at = now()
       WHERE id = v_credit_id;
      v_source := 'credit';
    ELSE
      v_source := 'none';
    END IF;
  END IF;

  INSERT INTO public.howbody_scan_consumptions (data_key, member_id, kind, source, credit_id)
  VALUES (_data_key, _member_id, _kind, v_source, v_credit_id)
  ON CONFLICT (data_key) DO NOTHING;

  RETURN jsonb_build_object('consumed', v_source <> 'none', 'duplicate', false,
    'source', v_source, 'credit_id', v_credit_id);
END;
$function$;

-- 6. consume_scan_credit_if_needed: same matching
CREATE OR REPLACE FUNCTION public.consume_scan_credit_if_needed(_member_id uuid, _kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quota jsonb;
  v_credit_id uuid;
  v_code text := CASE WHEN _kind='posture' THEN 'howbody_posture' ELSE '3d_body_scanning' END;
  v_enum public.benefit_type := CASE WHEN _kind='posture' THEN 'posture_scan'::public.benefit_type ELSE 'body_scan'::public.benefit_type END;
BEGIN
  v_quota := public.howbody_scan_quota(_member_id, _kind);
  IF (v_quota->>'plan_remaining')::int > 0 THEN
    RETURN false;
  END IF;
  IF (v_quota->>'addon_remaining')::int <= 0 THEN
    RETURN false;
  END IF;

  SELECT mbc.id INTO v_credit_id
    FROM public.member_benefit_credits mbc
    LEFT JOIN public.benefit_types bt ON bt.id = mbc.benefit_type_id
   WHERE mbc.member_id = _member_id
     AND mbc.credits_remaining > 0
     AND (mbc.expires_at IS NULL OR mbc.expires_at > now())
     AND (bt.code = v_code OR (mbc.benefit_type_id IS NULL AND mbc.benefit_type = v_enum))
   ORDER BY COALESCE(mbc.expires_at, 'infinity'::timestamptz) ASC, mbc.purchased_at ASC
   LIMIT 1
   FOR UPDATE OF mbc;

  IF v_credit_id IS NULL THEN RETURN false; END IF;

  UPDATE public.member_benefit_credits
     SET credits_remaining = credits_remaining - 1,
         updated_at = now()
   WHERE id = v_credit_id;
  RETURN true;
END;
$function$;
