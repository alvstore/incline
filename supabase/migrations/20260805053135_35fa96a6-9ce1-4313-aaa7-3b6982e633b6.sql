-- 1) Convenience fee becomes a pure quote; it must never mutate an invoice.
CREATE OR REPLACE FUNCTION public.quote_convenience_fee(p_invoice_id uuid, p_method text DEFAULT 'online')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  cfg jsonb;
  v_pct numeric; v_fixed numeric; v_gst_pct numeric; v_cap numeric; v_label text;
  v_base numeric; v_fee numeric; v_tax numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'invoice_not_found');
  END IF;

  -- Only online instruments carry a surcharge. Cash / UPI-manual / offline never do.
  IF COALESCE(p_method, 'online') NOT IN ('online', 'card', 'netbanking', 'wallet', 'upi_online') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'offline_method');
  END IF;

  IF inv.status NOT IN ('pending','partial','overdue','draft') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'invoice_not_payable');
  END IF;

  IF inv.pos_sale_id IS NOT NULL
     OR COALESCE(inv.invoice_type,'') IN ('pos','store','product')
     OR EXISTS (SELECT 1 FROM public.invoice_items
                 WHERE invoice_id = p_invoice_id AND reference_type IN ('product','pos'))
  THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'out_of_scope');
  END IF;

  SELECT COALESCE(config,'{}'::jsonb) INTO cfg
  FROM public.integration_settings
  WHERE integration_type = 'payment_gateway' AND provider = 'razorpay' AND is_active = true
    AND (branch_id = inv.branch_id OR branch_id IS NULL)
  ORDER BY (branch_id IS NULL)
  LIMIT 1;

  IF cfg IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_gateway');
  END IF;

  IF NOT COALESCE((cfg->>'convenience_fee_enabled')::boolean, false) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'disabled');
  END IF;

  v_pct     := COALESCE(NULLIF(cfg->>'convenience_fee_percent','')::numeric, 0);
  v_fixed   := COALESCE(NULLIF(cfg->>'convenience_fee_fixed','')::numeric, 0);
  v_gst_pct := COALESCE(NULLIF(cfg->>'convenience_fee_gst_percent','')::numeric, 18);
  v_cap     := NULLIF(cfg->>'convenience_fee_cap','')::numeric;
  v_label   := COALESCE(NULLIF(cfg->>'convenience_fee_label',''), 'Online payment convenience fee');

  v_base := GREATEST(0, COALESCE(inv.total_amount,0) - COALESCE(inv.amount_paid,0));
  IF v_base <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'nothing_due');
  END IF;

  v_fee := ROUND(v_base * v_pct / 100.0 + v_fixed, 2);
  IF v_cap IS NOT NULL AND v_cap > 0 THEN v_fee := LEAST(v_fee, v_cap); END IF;
  IF v_fee <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'zero_fee');
  END IF;

  v_tax := ROUND(v_fee * v_gst_pct / 100.0, 2);

  RETURN jsonb_build_object(
    'applied', true,
    'fee', v_fee,
    'fee_tax', v_tax,
    'fee_total', v_fee + v_tax,
    'label', v_label,
    'amount_due', v_base,
    'charge_amount', ROUND(v_base + v_fee + v_tax, 2),
    'invoice_total', inv.total_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quote_convenience_fee(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_convenience_fee(uuid, text) TO service_role, authenticated;

DROP FUNCTION IF EXISTS public.apply_convenience_fee(uuid);

-- 2) Repair invoices that still carry a baked-in convenience fee line.
DO $$
DECLARE r RECORD; v_fee numeric; v_tax numeric; v_total numeric;
BEGIN
  FOR r IN
    SELECT i.id, i.subtotal, i.tax_amount, i.total_amount, i.amount_paid
      FROM public.invoices i
     WHERE EXISTS (SELECT 1 FROM public.invoice_items ii
                    WHERE ii.invoice_id = i.id AND ii.reference_type = 'convenience_fee')
  LOOP
    SELECT COALESCE(SUM(unit_price * GREATEST(quantity,1)),0),
           COALESCE(SUM(tax_amount),0),
           COALESCE(SUM(total_amount),0)
      INTO v_fee, v_tax, v_total
      FROM public.invoice_items
     WHERE invoice_id = r.id AND reference_type = 'convenience_fee';

    DELETE FROM public.invoice_items
     WHERE invoice_id = r.id AND reference_type = 'convenience_fee';

    UPDATE public.invoices
       SET subtotal     = GREATEST(0, COALESCE(subtotal,0) - v_fee),
           tax_amount   = GREATEST(0, COALESCE(tax_amount,0) - v_tax),
           total_amount = GREATEST(0, COALESCE(total_amount,0) - v_total),
           status = (CASE
                       WHEN COALESCE(r.amount_paid,0) >= GREATEST(0, COALESCE(r.total_amount,0) - v_total) THEN 'paid'
                       WHEN COALESCE(r.amount_paid,0) > 0 THEN 'partial'
                       ELSE 'pending'
                     END)::invoice_status,
           notes = COALESCE(notes,'') || E'\n[' || to_char(now(),'YYYY-MM-DD HH24:MI') ||
                   '] Removed online convenience fee from invoice (surcharge is now charged only at payment time).',
           updated_at = now()
     WHERE id = r.id;
  END LOOP;
END $$;

-- 3) Reconciliation checker: tolerate header-level discounts so corrected
--    invoices stop being flagged forever.
CREATE OR REPLACE FUNCTION public.recheck_invoice_reconciliation(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_paid numeric; v_reversed numeric; v_net_paid numeric;
  v_items_total numeric; v_item_count int;
  v_disc_pre numeric; v_rate numeric; v_gap numeric; v_tax_gap numeric;
  v_findings text[] := ARRAY[]::text[];
BEGIN
  SELECT id, branch_id, status, amount_paid, total_amount, tax_amount, subtotal, discount_amount
    INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  IF v_inv.status = 'cancelled'::invoice_status THEN
    PERFORM public.resolve_reconciliation_finding('invoice_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
    RETURN jsonb_build_object('found', true, 'skipped', 'cancelled');
  END IF;

  SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'::payment_status), 0)
    INTO v_paid FROM public.payments p WHERE p.invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(r.amount), 0) INTO v_reversed
    FROM public.payments r
    JOIN public.payments orig ON orig.id = r.reversal_of
   WHERE r.invoice_id = p_invoice_id AND orig.status = 'completed'::payment_status;

  v_net_paid := v_paid - v_reversed;

  IF ABS(v_net_paid - COALESCE(v_inv.amount_paid, 0)) > 0.01 THEN
    PERFORM public.upsert_reconciliation_finding(
      'invoice_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
      jsonb_build_object('recorded', v_inv.amount_paid, 'actual', v_net_paid,
                         'delta', v_net_paid - COALESCE(v_inv.amount_paid, 0),
                         'gross_paid', v_paid, 'reversed', v_reversed));
    v_findings := v_findings || ARRAY['invoice_drift'];
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_drift', 'invoice', p_invoice_id);
  END IF;

  SELECT count(*), COALESCE(SUM(ii.total_amount), 0)
    INTO v_item_count, v_items_total
    FROM public.invoice_items ii WHERE ii.invoice_id = p_invoice_id;

  v_rate := CASE WHEN COALESCE(v_inv.subtotal,0) > 0
                 THEN COALESCE(v_inv.tax_amount,0) / v_inv.subtotal ELSE 0 END;
  v_disc_pre := COALESCE(v_inv.discount_amount,0) / (1 + v_rate);

  IF v_item_count > 0 THEN
    -- Lines may be stored pre-tax or tax-inclusive, gross or net of a
    -- header-level discount. Any of these conventions reconciles.
    v_gap := LEAST(
      ABS(v_items_total - (COALESCE(v_inv.subtotal,0) + v_disc_pre)),
      ABS(v_items_total - (COALESCE(v_inv.total_amount,0) + COALESCE(v_inv.discount_amount,0))),
      ABS(v_items_total - COALESCE(v_inv.subtotal,0)),
      ABS(v_items_total - COALESCE(v_inv.total_amount,0))
    );

    IF v_gap > 1.00 THEN
      PERFORM public.upsert_reconciliation_finding(
        'invoice_items_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
        jsonb_build_object('items_total', v_items_total, 'subtotal', v_inv.subtotal,
                           'total_amount', v_inv.total_amount,
                           'discount_amount', v_inv.discount_amount,
                           'delta', v_gap, 'item_count', v_item_count));
      v_findings := v_findings || ARRAY['invoice_items_drift'];
    ELSE
      PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    END IF;
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
  END IF;

  -- Tax identity: subtotal + tax = total, either gross or net of the discount.
  v_tax_gap := LEAST(
    ABS(COALESCE(v_inv.subtotal,0) + COALESCE(v_inv.tax_amount,0) - COALESCE(v_inv.total_amount,0)),
    ABS(COALESCE(v_inv.subtotal,0) - COALESCE(v_inv.discount_amount,0)
        + COALESCE(v_inv.tax_amount,0) - COALESCE(v_inv.total_amount,0))
  );

  IF v_tax_gap > 0.05
     OR (COALESCE(v_inv.tax_amount,0) > 0 AND ABS(v_rate * 100 - 5) > 0.3) THEN
    PERFORM public.upsert_reconciliation_finding(
      'invoice_tax_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
      jsonb_build_object('subtotal', v_inv.subtotal, 'tax_amount', v_inv.tax_amount,
                         'total_amount', v_inv.total_amount,
                         'effective_rate', ROUND(v_rate * 100, 2),
                         'delta', v_tax_gap));
    v_findings := v_findings || ARRAY['invoice_tax_drift'];
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
  END IF;

  RETURN jsonb_build_object('found', true, 'invoice_id', p_invoice_id,
                            'net_paid', v_net_paid, 'items_total', v_items_total,
                            'findings', to_jsonb(v_findings));
END;
$$;

-- 4) Re-run the checker across every invoice that currently has an open finding.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT reference_id FROM public.reconciliation_findings
            WHERE reference_type = 'invoice' AND resolved_at IS NULL AND reference_id IS NOT NULL
  LOOP
    PERFORM public.recheck_invoice_reconciliation(r.reference_id);
  END LOOP;
END $$;