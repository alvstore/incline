CREATE OR REPLACE FUNCTION public.apply_convenience_fee(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  cfg jsonb;
  v_enabled boolean;
  v_pct numeric;
  v_fixed numeric;
  v_gst_pct numeric;
  v_cap numeric;
  v_label text;
  v_existing_total numeric := 0;
  v_existing_tax numeric := 0;
  v_existing_fee numeric := 0;
  v_base numeric;
  v_fee numeric;
  v_tax numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'invoice_not_found');
  END IF;

  -- Remove any previously applied fee so the call is idempotent.
  SELECT COALESCE(SUM(total_amount), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(unit_price * GREATEST(quantity,1)), 0)
    INTO v_existing_total, v_existing_tax, v_existing_fee
  FROM public.invoice_items
  WHERE invoice_id = p_invoice_id AND reference_type = 'convenience_fee';

  IF v_existing_total > 0 THEN
    DELETE FROM public.invoice_items
      WHERE invoice_id = p_invoice_id AND reference_type = 'convenience_fee';
    UPDATE public.invoices
       SET subtotal = GREATEST(0, COALESCE(subtotal,0) - v_existing_fee),
           tax_amount = GREATEST(0, COALESCE(tax_amount,0) - v_existing_tax),
           total_amount = GREATEST(0, COALESCE(total_amount,0) - v_existing_total)
     WHERE id = p_invoice_id;
    SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  END IF;

  IF inv.status NOT IN ('pending', 'partial', 'overdue', 'draft') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'invoice_not_payable', 'total_amount', inv.total_amount);
  END IF;

  -- Scope guard: membership / PT / service invoices only. POS + store product
  -- invoices never carry a convenience fee.
  IF inv.pos_sale_id IS NOT NULL
     OR COALESCE(inv.invoice_type, '') IN ('pos', 'store', 'product')
     OR EXISTS (
          SELECT 1 FROM public.invoice_items
           WHERE invoice_id = p_invoice_id
             AND reference_type IN ('product', 'pos')
        )
  THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'out_of_scope', 'total_amount', inv.total_amount);
  END IF;

  -- Branch-specific gateway config first, then global.
  SELECT COALESCE(config, '{}'::jsonb) INTO cfg
  FROM public.integration_settings
  WHERE integration_type = 'payment_gateway'
    AND provider = 'razorpay'
    AND is_active = true
    AND (branch_id = inv.branch_id OR branch_id IS NULL)
  ORDER BY (branch_id IS NULL)
  LIMIT 1;

  IF cfg IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_gateway', 'total_amount', inv.total_amount);
  END IF;

  v_enabled := COALESCE((cfg->>'convenience_fee_enabled')::boolean, false);
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'disabled', 'total_amount', inv.total_amount);
  END IF;

  v_pct := COALESCE(NULLIF(cfg->>'convenience_fee_percent', '')::numeric, 0);
  v_fixed := COALESCE(NULLIF(cfg->>'convenience_fee_fixed', '')::numeric, 0);
  v_gst_pct := COALESCE(NULLIF(cfg->>'convenience_fee_gst_percent', '')::numeric, 18);
  v_cap := NULLIF(cfg->>'convenience_fee_cap', '')::numeric;
  v_label := COALESCE(NULLIF(cfg->>'convenience_fee_label', ''), 'Online payment convenience fee');

  v_base := GREATEST(0, COALESCE(inv.total_amount, 0) - COALESCE(inv.amount_paid, 0));
  IF v_base <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'nothing_due', 'total_amount', inv.total_amount);
  END IF;

  v_fee := ROUND(v_base * v_pct / 100.0 + v_fixed, 2);
  IF v_cap IS NOT NULL AND v_cap > 0 THEN
    v_fee := LEAST(v_fee, v_cap);
  END IF;

  IF v_fee <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'zero_fee', 'total_amount', inv.total_amount);
  END IF;

  v_tax := ROUND(v_fee * v_gst_pct / 100.0, 2);

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount, reference_type
  ) VALUES (
    p_invoice_id, v_label, 1, v_fee, v_gst_pct, v_tax, v_fee + v_tax, 'convenience_fee'
  );

  UPDATE public.invoices
     SET subtotal = COALESCE(subtotal, 0) + v_fee,
         tax_amount = COALESCE(tax_amount, 0) + v_tax,
         total_amount = COALESCE(total_amount, 0) + v_fee + v_tax,
         updated_at = now()
   WHERE id = p_invoice_id;

  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'applied', true,
    'fee', v_fee,
    'fee_tax', v_tax,
    'fee_total', v_fee + v_tax,
    'label', v_label,
    'total_amount', inv.total_amount,
    'amount_due', GREATEST(0, inv.total_amount - COALESCE(inv.amount_paid, 0))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_convenience_fee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_convenience_fee(uuid) TO service_role;