CREATE OR REPLACE FUNCTION public.create_pos_sale(p_branch_id uuid, p_member_id uuid, p_items jsonb, p_payment_method text, p_sold_by uuid, p_guest_name text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_guest_email text DEFAULT NULL::text, p_awaiting_payment boolean DEFAULT false, p_discount_amount numeric DEFAULT 0, p_discount_code_id uuid DEFAULT NULL::uuid, p_discount_code text DEFAULT NULL::text, p_wallet_applied numeric DEFAULT 0, p_transaction_id text DEFAULT NULL::text, p_slip_url text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_gst_percentage numeric DEFAULT 0, p_customer_gstin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_line jsonb;
  v_pid uuid;
  v_qty integer;
  v_pname text;
  v_pbatch boolean;
  v_avail integer;
  v_inv_id uuid;
  v_inv_qty integer;
  v_consume jsonb;
  v_enriched jsonb := '[]'::jsonb;
BEGIN
  -- Prices are recomputed server-side for members above; invoice totals are authoritative.
  PERFORM set_config('app.trusted_invoice', 'true', true);
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- Every caller (front desk and member store) may only sell active products that are switched on for POS.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
       JOIN public.products pr ON pr.id = NULLIF(e->>'product_id','')::uuid
       WHERE NOT COALESCE(pr.is_active, true) OR NOT COALESCE(pr.is_sellable, false)) THEN
    RAISE EXCEPTION 'One or more items are no longer available for sale. Refresh and try again.';
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

  -- Stock: deduct (or reserve, for payment links) every sold unit in the same transaction.
  -- Cancelling the invoice returns the stock via restore_pos_sale_stock().
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_pid := NULLIF(v_line->>'product_id','')::uuid;
    v_qty := GREATEST(0, FLOOR(COALESCE((v_line->>'quantity')::numeric, 0)))::integer;
    IF v_pid IS NULL OR v_qty = 0 THEN
      v_enriched := v_enriched || jsonb_build_array(v_line);
      CONTINUE;
    END IF;
    SELECT name, COALESCE(requires_batch_tracking, false) INTO v_pname, v_pbatch
      FROM public.products WHERE id = v_pid;
    IF v_pbatch THEN
      SELECT COALESCE(SUM(quantity_remaining), 0)::integer INTO v_avail
        FROM public.product_batches
       WHERE product_id = v_pid AND branch_id = p_branch_id AND status = 'active'
         AND quantity_remaining > 0 AND (exp_date IS NULL OR exp_date >= CURRENT_DATE);
      IF v_avail < v_qty THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: only % in-date unit(s) left of %', v_avail, v_pname USING ERRCODE = 'P0001';
      END IF;
      v_consume := public.consume_batch_stock(
        p_product_id := v_pid, p_branch_id := p_branch_id, p_quantity := v_qty,
        p_sold_by := v_sold_by, p_reference_id := v_pos_sale_id, p_reference_type := 'pos_sale',
        p_preferred_batch_id := NULLIF(v_line->>'batch_id','')::uuid);
      v_enriched := v_enriched || jsonb_build_array(v_line || jsonb_build_object('batches', v_consume->'batches'));
    ELSE
      SELECT id, COALESCE(quantity, 0) INTO v_inv_id, v_inv_qty
        FROM public.inventory WHERE product_id = v_pid AND branch_id = p_branch_id FOR UPDATE;
      IF FOUND THEN
        IF v_inv_qty < v_qty THEN
          RAISE EXCEPTION 'OUT_OF_STOCK: only % left of %', v_inv_qty, v_pname USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.inventory SET quantity = v_inv_qty - v_qty WHERE id = v_inv_id;
        INSERT INTO public.stock_movements (product_id, branch_id, movement_type, quantity, reference_id, reference_type, notes, created_by)
        VALUES (v_pid, p_branch_id, 'sale', v_qty, v_pos_sale_id, 'pos_sale', 'POS sale', v_sold_by);
      END IF;
      v_enriched := v_enriched || jsonb_build_array(v_line);
    END IF;
  END LOOP;
  UPDATE public.pos_sales SET items = v_enriched WHERE id = v_pos_sale_id;

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
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total_amount, reference_type, reference_id)
    SELECT v_invoice_id, COALESCE(NULLIF(e->>'name',''), 'Store item'), COALESCE((e->>'quantity')::numeric,1)::int,
           COALESCE((e->>'unit_price')::numeric, (e->>'price')::numeric, 0),
           COALESCE((e->>'total')::numeric, 0), 'product', NULLIF(e->>'product_id','')::uuid
      FROM jsonb_array_elements(v_items) e;

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
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total_amount, reference_type, reference_id)
    SELECT v_invoice_id, COALESCE(NULLIF(e->>'name',''), 'Store item'), COALESCE((e->>'quantity')::numeric,1)::int,
           COALESCE((e->>'unit_price')::numeric, (e->>'price')::numeric, 0),
           COALESCE((e->>'total')::numeric, 0), 'product', NULLIF(e->>'product_id','')::uuid
      FROM jsonb_array_elements(v_items) e;

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