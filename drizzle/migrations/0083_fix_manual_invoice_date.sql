CREATE OR REPLACE FUNCTION public.create_manual_invoice(p_branch_id uuid, p_member_id uuid, p_items jsonb, p_due_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_discount_amount numeric DEFAULT 0, p_include_gst boolean DEFAULT false, p_gst_rate numeric DEFAULT 0, p_customer_gstin text DEFAULT NULL::text, p_gst_inclusive boolean DEFAULT false, p_invoice_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gross numeric := 0;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_item_unit numeric;
  v_item_qty numeric;
  v_invoice_date date := COALESCE(p_invoice_date, CURRENT_DATE);
BEGIN
  -- SEC_GUARD_STAFF_V1
  IF NOT public.is_staff_or_system() THEN
    RAISE EXCEPTION 'Unauthorized: staff role required' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'BRANCH_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'NO_ITEMS' USING ERRCODE = '22023'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_gross := v_gross + (COALESCE((v_item->>'quantity')::numeric, 1) * COALESCE((v_item->>'unit_price')::numeric, 0));
  END LOOP;

  IF p_include_gst AND p_gst_rate > 0 THEN
    IF p_gst_inclusive THEN
      v_subtotal := round((v_gross - COALESCE(p_discount_amount, 0)) / (1 + p_gst_rate/100.0), 2);
      v_total    := round(v_gross - COALESCE(p_discount_amount, 0), 2);
      v_tax      := round(v_total - v_subtotal, 2);
    ELSE
      v_subtotal := round(v_gross - COALESCE(p_discount_amount, 0), 2);
      v_tax := round(v_subtotal * p_gst_rate / 100.0, 2);
      v_total := v_subtotal + v_tax;
    END IF;
  ELSE
    v_subtotal := round(v_gross - COALESCE(p_discount_amount, 0), 2);
    v_total := v_subtotal;
  END IF;

  INSERT INTO public.invoices (
    branch_id, member_id, invoice_number, subtotal, discount_amount, tax_amount, total_amount,
    status, due_date, created_at, notes, is_gst_invoice, gst_rate, customer_gstin
  ) VALUES (
    p_branch_id, p_member_id, NULL, v_subtotal, COALESCE(p_discount_amount, 0), v_tax, v_total,
    'pending', p_due_date,
    CASE WHEN v_invoice_date = CURRENT_DATE THEN now() ELSE (v_invoice_date + time '12:00') AT TIME ZONE 'Asia/Kolkata' END,
    p_notes,
    COALESCE(p_include_gst, false),
    CASE WHEN p_include_gst THEN p_gst_rate ELSE 0 END,
    CASE WHEN p_include_gst THEN p_customer_gstin ELSE NULL END
  ) RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_qty := COALESCE((v_item->>'quantity')::numeric, 1);
    v_item_unit := COALESCE((v_item->>'unit_price')::numeric, 0);
    IF p_include_gst AND p_gst_inclusive AND p_gst_rate > 0 THEN
      v_item_unit := round(v_item_unit / (1 + p_gst_rate/100.0), 2);
    END IF;
    INSERT INTO public.invoice_items (
      invoice_id, description, quantity, unit_price, total_amount, reference_type, reference_id
    ) VALUES (
      v_invoice_id, v_item->>'description', v_item_qty, v_item_unit, v_item_qty * v_item_unit,
      v_item->>'reference_type', NULLIF(v_item->>'reference_id', '')::uuid
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'total_amount', v_total
  );
END;
$function$;