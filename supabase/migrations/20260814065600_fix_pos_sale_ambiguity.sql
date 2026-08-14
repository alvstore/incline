-- Drop all overloads to fix "Could not choose the best candidate function"
DROP FUNCTION IF EXISTS public.create_pos_sale(uuid, uuid, jsonb, text, uuid, text, text, text, boolean, numeric, uuid, text, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.create_pos_sale(uuid, uuid, jsonb, text, uuid, text, text, text, boolean, numeric, uuid, text, numeric, text, text, text, numeric, text);

-- Re-create the canonical version with the full signature required by the frontend
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_branch_id uuid,
  p_member_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_sold_by uuid,
  p_guest_name text DEFAULT NULL,
  p_guest_phone text DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_awaiting_payment boolean DEFAULT false,
  p_discount_amount numeric DEFAULT 0,
  p_discount_code_id uuid DEFAULT NULL,
  p_discount_code text DEFAULT NULL,
  p_wallet_applied numeric DEFAULT 0,
  p_transaction_id text DEFAULT NULL,
  p_slip_url text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_gst_percentage numeric DEFAULT 0,
  p_customer_gstin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric := 0;
  v_total numeric;
  v_discount numeric := COALESCE(p_discount_amount, 0);
  v_wallet_applied numeric := COALESCE(p_wallet_applied, 0);
  v_remainder numeric;
  v_is_awaiting boolean := COALESCE(p_awaiting_payment, false);
  v_customer_name text := NULLIF(TRIM(COALESCE(p_guest_name, '')), '');
  v_customer_phone text := NULLIF(TRIM(COALESCE(p_guest_phone, '')), '');
  v_customer_email text := NULLIF(TRIM(COALESCE(p_guest_email, '')), '');
  v_pos_sale_id uuid;
  v_invoice_id uuid;
  v_item record;
  v_notes text;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(total numeric) LOOP
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
  )
  VALUES (
    p_branch_id, p_member_id, p_items, v_total, p_payment_method::payment_method, 
    p_sold_by, v_customer_name, v_customer_phone, v_customer_email,
    CASE WHEN v_is_awaiting THEN 'awaiting_payment' ELSE 'paid' END
  )
  RETURNING id INTO v_pos_sale_id;

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, discount_amount, total_amount,
    amount_paid, status, due_date, pos_sale_id, source, notes,
    customer_name, customer_email, customer_phone,
    gst_percentage, customer_gstin
  ) VALUES (
    p_branch_id, p_member_id, v_subtotal, NULLIF(v_discount, 0), v_total,
    CASE WHEN v_is_awaiting THEN 0 ELSE v_total END,
    CASE WHEN v_is_awaiting THEN 'pending'::invoice_status ELSE 'paid'::invoice_status END,
    CURRENT_DATE, v_pos_sale_id, 'pos', v_notes,
    v_customer_name, v_customer_email, v_customer_phone,
    p_gst_percentage, p_customer_gstin
  ) RETURNING id INTO v_invoice_id;

  UPDATE public.pos_sales SET invoice_id = v_invoice_id WHERE id = v_pos_sale_id;

  IF NOT v_is_awaiting AND v_remainder > 0 THEN
    PERFORM public.settle_payment(
      p_branch_id := p_branch_id, 
      p_invoice_id := v_invoice_id, 
      p_member_id := p_member_id,
      p_amount := v_remainder, 
      p_payment_method := p_payment_method, 
      p_transaction_id := p_transaction_id,
      p_notes := v_notes, 
      p_received_by := p_sold_by, 
      p_payment_source := 'pos_sale',
      p_idempotency_key := COALESCE(p_idempotency_key, v_pos_sale_id::text) || ':remainder'
    );
  END IF;

  RETURN jsonb_build_object(
    'pos_sale_id', v_pos_sale_id, 
    'invoice_id', v_invoice_id,
    'total', v_total, 
    'awaiting', v_is_awaiting
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pos_sale(uuid, uuid, jsonb, text, uuid, text, text, text, boolean, numeric, uuid, text, numeric, text, text, text, numeric, text) TO authenticated, service_role;
