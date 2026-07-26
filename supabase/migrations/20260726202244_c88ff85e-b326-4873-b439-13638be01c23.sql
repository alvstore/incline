
-- ============================================================
-- PART A — correct_invoice RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.correct_invoice(
  p_invoice_id uuid,
  p_new_subtotal numeric,
  p_new_discount numeric,
  p_new_tax numeric,
  p_new_total numeric,
  p_reason text,
  p_settlement text DEFAULT 'leave_due',  -- 'leave_due' | 'refund_wallet' | 'refund_cash' | 'refund_upi' | 'credit_wallet'
  p_line_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inv RECORD;
  v_delta numeric;
  v_new_amount_paid numeric;
  v_new_status text;
  v_new_payment_id uuid;
  v_membership_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT has_capability(v_actor, 'approve_discount') THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only owners/admins/managers may correct invoices'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(trim(p_reason), '') = '' OR length(trim(p_reason)) < 6 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: please provide a reason (min 6 chars)' USING ERRCODE = '22023';
  END IF;

  IF p_settlement NOT IN ('leave_due','refund_wallet','refund_cash','refund_upi','credit_wallet') THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT: %', p_settlement USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'CANNOT_CORRECT_CANCELLED_INVOICE' USING ERRCODE = '22023';
  END IF;

  IF p_new_total < 0 OR p_new_subtotal < 0 OR p_new_discount < 0 OR p_new_tax < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_AMOUNT_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  -- delta = overpayment = current paid - new total (positive => refund/credit needed)
  v_delta := coalesce(v_inv.amount_paid, 0) - p_new_total;

  -- Update invoice
  UPDATE public.invoices
     SET subtotal = p_new_subtotal,
         discount_amount = p_new_discount,
         tax_amount = p_new_tax,
         total_amount = p_new_total,
         status = CASE
                    WHEN coalesce(v_inv.amount_paid,0) >= p_new_total THEN 'paid'
                    WHEN coalesce(v_inv.amount_paid,0) > 0 THEN 'partial'
                    ELSE 'pending'
                  END,
         notes = coalesce(v_inv.notes,'') ||
                 E'\n[' || to_char(now(),'YYYY-MM-DD HH24:MI') ||
                 '] Corrected by ' || coalesce(v_actor::text,'system') ||
                 ': ' || trim(p_reason),
         updated_at = now()
   WHERE id = p_invoice_id;

  -- Update the primary invoice line (single line-item invoices — most cases)
  UPDATE public.invoice_items
     SET unit_price = p_new_subtotal,
         tax_amount = p_new_tax,
         total_amount = p_new_total,
         description = coalesce(p_line_description, description)
   WHERE invoice_id = p_invoice_id
     AND id = (SELECT id FROM public.invoice_items WHERE invoice_id = p_invoice_id ORDER BY created_at ASC LIMIT 1);

  -- Mirror to membership row (if this invoice was for a membership)
  SELECT id INTO v_membership_id
    FROM public.memberships
   WHERE member_id = v_inv.member_id
     AND created_at BETWEEN v_inv.created_at - interval '1 day' AND v_inv.created_at + interval '1 day'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_membership_id IS NOT NULL THEN
    UPDATE public.memberships
       SET price_paid = p_new_total,
           discount_amount = p_new_discount,
           discount_reason = 'Invoice corrected: ' || trim(p_reason),
           updated_at = now()
     WHERE id = v_membership_id;
  END IF;

  -- Settlement of overpayment (delta > 0)
  IF v_delta > 0 AND p_settlement <> 'leave_due' THEN
    IF p_settlement = 'credit_wallet' THEN
      -- Credit to member wallet
      IF v_inv.member_id IS NOT NULL THEN
        INSERT INTO public.wallet_transactions (
          wallet_id, amount, type, reference_type, reference_id, notes, created_by
        )
        SELECT w.id, v_delta, 'credit', 'invoice_correction', p_invoice_id,
               'Wallet credit from corrected invoice ' || v_inv.invoice_number, v_actor
          FROM public.wallets w WHERE w.member_id = v_inv.member_id
         LIMIT 1;
        UPDATE public.wallets SET balance = balance + v_delta, updated_at = now()
         WHERE member_id = v_inv.member_id;
      END IF;
    ELSE
      -- Insert a refund payment row (cash / upi / wallet)
      INSERT INTO public.payments (
        branch_id, invoice_id, member_id, amount, payment_method, status,
        payment_date, notes, lifecycle_status, payment_source
      ) VALUES (
        v_inv.branch_id,
        p_invoice_id,
        v_inv.member_id,
        v_delta,
        CASE p_settlement WHEN 'refund_cash' THEN 'cash'::payment_method
                          WHEN 'refund_upi'  THEN 'upi'::payment_method
                          WHEN 'refund_wallet' THEN 'wallet'::payment_method END,
        'refunded',
        now(),
        'Refund ₹' || v_delta::text || ' from invoice correction. Reason: ' || trim(p_reason),
        'voided',
        'manual'
      )
      RETURNING id INTO v_new_payment_id;
    END IF;

    -- Recompute amount_paid net of refunds
    v_new_amount_paid := coalesce(v_inv.amount_paid,0) - v_delta;
    UPDATE public.invoices
       SET amount_paid = v_new_amount_paid,
           status = CASE
                      WHEN v_new_amount_paid >= p_new_total THEN 'paid'
                      WHEN v_new_amount_paid > 0 THEN 'partial'
                      ELSE 'pending'
                    END
     WHERE id = p_invoice_id;
  END IF;

  -- Audit log
  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, branch_id, before_data, after_data, notes
  ) VALUES (
    v_actor, 'invoice_corrected', 'invoice', p_invoice_id, v_inv.branch_id,
    jsonb_build_object(
      'subtotal', v_inv.subtotal,
      'discount_amount', v_inv.discount_amount,
      'tax_amount', v_inv.tax_amount,
      'total_amount', v_inv.total_amount,
      'amount_paid', v_inv.amount_paid,
      'status', v_inv.status
    ),
    jsonb_build_object(
      'subtotal', p_new_subtotal,
      'discount_amount', p_new_discount,
      'tax_amount', p_new_tax,
      'total_amount', p_new_total,
      'settlement', p_settlement,
      'delta', v_delta
    ),
    trim(p_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'delta', v_delta,
    'settlement', p_settlement,
    'refund_payment_id', v_new_payment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.correct_invoice(uuid, numeric, numeric, numeric, numeric, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.correct_invoice(uuid, numeric, numeric, numeric, numeric, text, text, text) FROM anon;

-- ============================================================
-- PART B — organization_settings branding leak fix
-- ============================================================
-- Drop the overly-permissive "any authenticated" policy that
-- exposed webhook_slug, alert_config, hsn_defaults etc.
DROP POLICY IF EXISTS "Any authenticated user can view org branding" ON public.organization_settings;

-- Safe SECURITY DEFINER helper that only returns non-sensitive branding columns.
CREATE OR REPLACE FUNCTION public.get_org_branding(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  branch_id uuid,
  name text,
  logo_url text,
  website_theme jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, branch_id, name, logo_url, website_theme
    FROM public.organization_settings
   WHERE (_branch_id IS NULL AND branch_id IS NULL)
      OR (branch_id = _branch_id)
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_branding(uuid) TO anon, authenticated;
