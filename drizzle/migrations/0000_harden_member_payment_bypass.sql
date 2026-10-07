
CREATE OR REPLACE FUNCTION public.is_staff_or_system()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL
      OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.is_staff_or_system() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_system() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._inject_guard(p_fn regprocedure, p_marker text, p_guard text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef(p_fn);
  IF position(p_marker in d) > 0 THEN RETURN; END IF;
  n := regexp_replace(d, '(\$function\$.*?\nBEGIN[ \t]*\n)', E'\\1  -- ' || p_marker || E'\n' || p_guard || E'\n');
  IF n = d THEN RAISE EXCEPTION 'guard injection failed for %', p_fn; END IF;
  EXECUTE n;
END $$;

DO $$
DECLARE
  g_staff text := $g$  IF NOT public.is_staff_or_system() THEN
    RAISE EXCEPTION 'Unauthorized: staff role required' USING ERRCODE = '42501';
  END IF;$g$;
  f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN
             ('record_payment','void_payment','reverse_payment','create_manual_invoice',
              'assign_locker_with_billing','activate_pt_package','purchase_membership')
  LOOP
    PERFORM public._inject_guard(f, 'SEC_GUARD_STAFF_V1', g_staff);
  END LOOP;

  PERFORM public._inject_guard(
    'public.settle_payment(uuid,uuid,uuid,numeric,text,text,text,uuid,uuid,text,text,text,uuid,jsonb)'::regprocedure,
    'SEC_GUARD_SETTLE_V1',
    $g$  IF NOT public.is_staff_or_system() AND NOT (
       p_payment_method = 'wallet' AND EXISTS (
         SELECT 1 FROM public.invoices i JOIN public.members m ON m.id = i.member_id
         WHERE i.id = p_invoice_id AND m.user_id = auth.uid()
           AND (p_member_id IS NULL OR p_member_id = i.member_id))) THEN
    RAISE EXCEPTION 'Unauthorized: payments must be confirmed by the payment gateway or staff' USING ERRCODE = '42501';
  END IF;$g$);

  PERFORM public._inject_guard(
    'public.purchase_benefit_credits(uuid,uuid,uuid,uuid,text,text,uuid,boolean)'::regprocedure,
    'SEC_GUARD_ADDON_V1',
    $g$  IF NOT public.is_staff_or_system() THEN
    IF NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Unauthorized: you can only buy add-ons for yourself' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(p_defer_settlement, false) AND COALESCE(p_payment_method,'') <> 'wallet' THEN
      RAISE EXCEPTION 'Unauthorized: members must pay online or from wallet' USING ERRCODE = '42501';
    END IF;
    p_received_by := NULL;
  END IF;$g$);

  PERFORM public._inject_guard(
    'public.purchase_member_membership(uuid,uuid,uuid,date,numeric,text,text,numeric,text,boolean,numeric,date,boolean,uuid,text,uuid,text,text)'::regprocedure,
    'SEC_GUARD_MEMBERSHIP_V1',
    $g$  IF NOT public.is_staff_or_system() THEN
    IF NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Unauthorized: you can only buy a plan for yourself' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(p_amount_paying, 0) > 0 THEN
      RAISE EXCEPTION 'Unauthorized: members must pay through secure online checkout' USING ERRCODE = '42501';
    END IF;
    p_discount_amount := 0;
    p_assign_locker_id := NULL;
    p_payment_due_date := NULL;
    p_received_by := NULL;
    p_transaction_id := NULL;
    p_start_date := GREATEST(p_start_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  END IF;$g$);

  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='claim_referral_reward' LOOP
    PERFORM public._inject_guard(f, 'SEC_GUARD_OWNER_V1',
    $g$  IF NOT public.is_staff_or_system()
     AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;$g$);
  END LOOP;

  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='add_to_waitlist' LOOP
    PERFORM public._inject_guard(f, 'SEC_GUARD_OWNER_V1',
    $g$  IF NOT public.is_staff_or_system()
     AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = _member_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;$g$);
  END LOOP;
END $$;

DROP FUNCTION public._inject_guard(regprocedure, text, text);

CREATE OR REPLACE FUNCTION public.activate_benefit_credits_for_invoice(_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_inv RECORD; v_item RECORD; v_pkg RECORD; v_membership_id uuid; v_credit_id uuid;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF NOT public.is_staff_or_system()
     AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = v_inv.member_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_benefit_credits WHERE invoice_id = _invoice_id) THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  IF v_inv.status <> 'paid'::public.invoice_status
     OR COALESCE(v_inv.amount_paid, 0) + 0.01 < COALESCE(v_inv.total_amount, 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice is not fully paid');
  END IF;

  SELECT * INTO v_item FROM public.invoice_items
  WHERE invoice_id = _invoice_id AND reference_type = 'benefit_package' LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No benefit package line item');
  END IF;

  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = v_item.reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  SELECT id INTO v_membership_id FROM public.memberships
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

CREATE OR REPLACE FUNCTION public.create_pos_sale(p_branch_id uuid, p_member_id uuid, p_items jsonb, p_payment_method text, p_sold_by uuid, p_guest_name text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_guest_email text DEFAULT NULL::text, p_awaiting_payment boolean DEFAULT false, p_discount_amount numeric DEFAULT 0, p_discount_code_id uuid DEFAULT NULL::uuid, p_discount_code text DEFAULT NULL::text, p_wallet_applied numeric DEFAULT 0, p_transaction_id text DEFAULT NULL::text, p_slip_url text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_gst_percentage numeric DEFAULT 0, p_customer_gstin text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_staff boolean := public.is_staff_or_system();
  v_subtotal numeric := 0;
  v_total numeric;
  v_discount numeric := COALESCE(p_discount_amount, 0);
  v_wallet_applied numeric := COALESCE(p_wallet_applied, 0);
  v_remainder numeric;
  v_is_awaiting boolean := COALESCE(p_awaiting_payment, false);
  v_customer_name text := NULLIF(TRIM(COALESCE(p_guest_name, '')), '');
  v_customer_phone text := NULLIF(TRIM(COALESCE(p_guest_phone, '')), '');
  v_customer_email text := NULLIF(TRIM(COALESCE(p_guest_email, '')), '');
  v_items jsonb := p_items;
  v_pos_sale_id uuid;
  v_invoice_id uuid;
  v_item record;
  v_notes text;
  v_code record;
  v_settle jsonb;
  v_method text := p_payment_method;
  v_sold_by uuid := p_sold_by;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF NOT v_is_staff THEN
    IF p_member_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Unauthorized: you can only buy for yourself' USING ERRCODE = '42501';
    END IF;
    v_sold_by := auth.uid();

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
         LEFT JOIN public.products pr ON pr.id = NULLIF(e->>'product_id','')::uuid
         WHERE pr.id IS NULL OR NOT COALESCE(pr.is_active, true)) THEN
      RAISE EXCEPTION 'One or more products are unavailable';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'product_id', pr.id, 'name', pr.name,
             'quantity', x.qty, 'unit_price', pr.price, 'total', pr.price * x.qty)), '[]'::jsonb)
      INTO v_items
      FROM (SELECT (e->>'product_id')::uuid AS pid,
                   GREATEST(1, LEAST(100, FLOOR(COALESCE((e->>'quantity')::numeric, 1))))::int AS qty
              FROM jsonb_array_elements(p_items) e) x
      JOIN public.products pr ON pr.id = x.pid;

    v_discount := 0;
    IF p_discount_code_id IS NOT NULL THEN
      SELECT * INTO v_code FROM public.discount_codes WHERE id = p_discount_code_id;
      IF FOUND AND COALESCE(v_code.is_active, false)
         AND (v_code.valid_from IS NULL OR v_code.valid_from <= CURRENT_DATE)
         AND (v_code.valid_until IS NULL OR v_code.valid_until >= CURRENT_DATE)
         AND (v_code.max_uses IS NULL OR COALESCE(v_code.times_used, 0) < v_code.max_uses)
         AND (v_code.branch_id IS NULL OR v_code.branch_id = p_branch_id) THEN
        SELECT COALESCE(SUM((e->>'total')::numeric), 0) INTO v_subtotal FROM jsonb_array_elements(v_items) e;
        IF v_subtotal >= COALESCE(v_code.min_purchase, 0) THEN
          v_discount := CASE WHEN v_code.discount_type ILIKE 'percent%'
                             THEN ROUND(v_subtotal * LEAST(v_code.discount_value, 100) / 100.0, 2)
                             ELSE COALESCE(v_code.discount_value, 0) END;
        END IF;
        v_subtotal := 0;
      END IF;
    END IF;

    IF NOT v_is_awaiting THEN
      IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'Online payment required' USING ERRCODE = '42501';
      END IF;
      v_method := 'wallet';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_items) AS x(total numeric) LOOP
    v_subtotal := v_subtotal + COALESCE(v_item.total, 0);
  END LOOP;

  v_discount := GREATEST(0, LEAST(v_discount, v_subtotal));
  v_total := GREATEST(0, v_subtotal - v_discount);

  IF v_is_awaiting THEN
    v_wallet_applied := 0;
    v_remainder := v_total;
  ELSE
    v_wallet_applied := GREATEST(0, LEAST(v_wallet_applied, v_total));
    v_remainder := GREATEST(0, v_total - v_wallet_applied);
  END IF;

  v_notes := 'POS Sale' || CASE WHEN v_is_awaiting THEN ' (Awaiting Payment)' ELSE '' END;
  IF p_idempotency_key IS NOT NULL THEN
    v_notes := v_notes || ' [idem:' || p_idempotency_key || ']';
  END IF;

  INSERT INTO public.pos_sales (
    branch_id, member_id, items, total_amount, payment_method,
    sold_by, customer_name, customer_phone, customer_email, payment_status
  ) VALUES (
    p_branch_id, p_member_id, v_items, v_total, v_method::payment_method,
    v_sold_by, v_customer_name, v_customer_phone, v_customer_email,
    CASE WHEN v_is_awaiting THEN 'awaiting_payment' ELSE 'paid' END
  ) RETURNING id INTO v_pos_sale_id;

  IF v_is_staff THEN
    INSERT INTO public.invoices (
      branch_id, member_id, subtotal, discount_amount, total_amount,
      amount_paid, status, due_date, pos_sale_id, source, notes,
      customer_name, customer_email, customer_phone, gst_rate, customer_gstin
    ) VALUES (
      p_branch_id, p_member_id, v_subtotal, NULLIF(v_discount, 0), v_total,
      CASE WHEN v_is_awaiting THEN 0 ELSE v_total END,
      CASE WHEN v_is_awaiting THEN 'pending'::invoice_status ELSE 'paid'::invoice_status END,
      CURRENT_DATE, v_pos_sale_id, 'pos', v_notes,
      v_customer_name, v_customer_email, v_customer_phone, p_gst_percentage, p_customer_gstin
    ) RETURNING id INTO v_invoice_id;

    UPDATE public.pos_sales SET invoice_id = v_invoice_id WHERE id = v_pos_sale_id;

    IF NOT v_is_awaiting AND v_remainder > 0 THEN
      PERFORM public.settle_payment(
        p_branch_id := p_branch_id, p_invoice_id := v_invoice_id, p_member_id := p_member_id,
        p_amount := v_remainder, p_payment_method := v_method, p_transaction_id := p_transaction_id,
        p_notes := v_notes, p_received_by := v_sold_by, p_payment_source := 'pos_sale',
        p_idempotency_key := COALESCE(p_idempotency_key, v_pos_sale_id::text) || ':remainder');
    END IF;
  ELSE
    INSERT INTO public.invoices (
      branch_id, member_id, subtotal, discount_amount, total_amount,
      amount_paid, status, due_date, pos_sale_id, source, notes,
      customer_name, customer_email, customer_phone, gst_rate, customer_gstin
    ) VALUES (
      p_branch_id, p_member_id, v_subtotal, NULLIF(v_discount, 0), v_total,
      0, CASE WHEN v_total = 0 THEN 'paid'::invoice_status ELSE 'pending'::invoice_status END,
      CURRENT_DATE, v_pos_sale_id, 'pos', v_notes,
      v_customer_name, v_customer_email, v_customer_phone, p_gst_percentage, p_customer_gstin
    ) RETURNING id INTO v_invoice_id;

    UPDATE public.pos_sales SET invoice_id = v_invoice_id WHERE id = v_pos_sale_id;

    IF NOT v_is_awaiting AND v_total > 0 THEN
      v_settle := public.settle_payment(
        p_branch_id := p_branch_id, p_invoice_id := v_invoice_id, p_member_id := p_member_id,
        p_amount := v_total, p_payment_method := 'wallet', p_notes := v_notes,
        p_received_by := v_sold_by, p_payment_source := 'pos_sale',
        p_idempotency_key := COALESCE(p_idempotency_key, v_pos_sale_id::text) || ':wallet');
      IF COALESCE((v_settle->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Payment failed: %', COALESCE(v_settle->>'error', 'wallet payment declined');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('pos_sale_id', v_pos_sale_id, 'invoice_id', v_invoice_id,
                            'total', v_total, 'awaiting', v_is_awaiting);
END;
$function$;

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN
           ('settle_payment','record_payment','void_payment','reverse_payment','create_manual_invoice',
            'assign_locker_with_billing','activate_pt_package','purchase_membership','purchase_member_membership',
            'purchase_benefit_credits','activate_benefit_credits_for_invoice','create_pos_sale',
            'claim_referral_reward','add_to_waitlist')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Members can create own bookings" ON public.benefit_bookings;
DROP POLICY IF EXISTS "Members can update own bookings" ON public.benefit_bookings;
CREATE POLICY "Staff create bookings in visible branches" ON public.benefit_bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner']::app_role[])
    OR (public.has_any_role(auth.uid(), ARRAY['admin','manager','staff']::app_role[])
        AND EXISTS (SELECT 1 FROM public.members m WHERE m.id = benefit_bookings.member_id
                    AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))));
CREATE POLICY "Staff update bookings in visible branches" ON public.benefit_bookings
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['owner']::app_role[])
    OR (public.has_any_role(auth.uid(), ARRAY['admin','manager','staff']::app_role[])
        AND EXISTS (SELECT 1 FROM public.members m WHERE m.id = benefit_bookings.member_id
                    AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner']::app_role[])
    OR (public.has_any_role(auth.uid(), ARRAY['admin','manager','staff']::app_role[])
        AND EXISTS (SELECT 1 FROM public.members m WHERE m.id = benefit_bookings.member_id
                    AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))));
DROP POLICY IF EXISTS "Members can book" ON public.class_bookings;
