CREATE OR REPLACE FUNCTION public.correct_invoice(p_invoice_id uuid, p_new_subtotal numeric, p_new_discount numeric, p_new_tax numeric, p_new_total numeric, p_reason text, p_settlement text DEFAULT 'leave_due'::text, p_line_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_inv RECORD;
  v_delta numeric;
  v_new_amount_paid numeric;
  v_new_payment_id uuid;
  v_membership_id uuid;
  v_actor_name text;
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

  v_delta := coalesce(v_inv.amount_paid, 0) - p_new_total;

  UPDATE public.invoices
     SET subtotal = p_new_subtotal,
         discount_amount = p_new_discount,
         tax_amount = p_new_tax,
         total_amount = p_new_total,
         status = (CASE
                    WHEN coalesce(v_inv.amount_paid,0) >= p_new_total THEN 'paid'
                    WHEN coalesce(v_inv.amount_paid,0) > 0 THEN 'partial'
                    ELSE 'pending'
                  END)::invoice_status,
         notes = coalesce(v_inv.notes,'') ||
                 E'\n[' || to_char(now(),'YYYY-MM-DD HH24:MI') ||
                 '] Corrected by ' || coalesce(v_actor::text,'system') ||
                 ': ' || trim(p_reason),
         updated_at = now()
   WHERE id = p_invoice_id;

  UPDATE public.invoice_items
     SET unit_price = p_new_subtotal,
         tax_amount = p_new_tax,
         total_amount = p_new_total,
         description = coalesce(p_line_description, description)
   WHERE invoice_id = p_invoice_id
     AND id = (SELECT id FROM public.invoice_items WHERE invoice_id = p_invoice_id ORDER BY created_at ASC LIMIT 1);

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

  IF v_delta > 0 AND p_settlement <> 'leave_due' THEN
    IF p_settlement = 'credit_wallet' THEN
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
        'refunded'::payment_status,
        now(),
        'Refund ' || v_delta::text || ' from invoice correction. Reason: ' || trim(p_reason),
        'voided',
        'manual'
      )
      RETURNING id INTO v_new_payment_id;
    END IF;

    v_new_amount_paid := coalesce(v_inv.amount_paid,0) - v_delta;
    UPDATE public.invoices
       SET amount_paid = v_new_amount_paid,
           status = (CASE
                      WHEN v_new_amount_paid >= p_new_total THEN 'paid'
                      WHEN v_new_amount_paid > 0 THEN 'partial'
                      ELSE 'pending'
                    END)::invoice_status
     WHERE id = p_invoice_id;
  END IF;

  -- Audit trail (best effort — never block the correction).
  BEGIN
    SELECT NULLIF(full_name,'') INTO v_actor_name FROM public.profiles WHERE id = v_actor;
    INSERT INTO public.audit_logs (
      user_id, actor_name, action, table_name, record_id, branch_id,
      old_data, new_data, action_description
    ) VALUES (
      v_actor, coalesce(v_actor_name,'System'), 'invoice_corrected', 'invoices', p_invoice_id, v_inv.branch_id,
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
      'Invoice ' || coalesce(v_inv.invoice_number,'') || ' corrected: ' || trim(p_reason)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'delta', v_delta,
    'settlement', p_settlement,
    'refund_payment_id', v_new_payment_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(_invoice_id uuid, _reason text DEFAULT 'manual_cancel'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv invoices%ROWTYPE;
  v_pay record;
  v_item record;
  v_pkg record;
  v_voided_payments int := 0;
  v_reversed_commissions int := 0;
  v_cancelled_packages int := 0;
  v_actor_name text;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_any_role(
    v_uid, ARRAY['owner','admin','manager']::app_role[]
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  IF v_inv.status IN ('cancelled','refunded') THEN
    RETURN jsonb_build_object(
      'success', true,
      'invoice_id', _invoice_id,
      'already', v_inv.status::text,
      'idempotent', true
    );
  END IF;

  FOR v_pay IN
    SELECT id, status FROM payments
    WHERE invoice_id = _invoice_id
      AND status NOT IN ('refunded','failed')
    ORDER BY created_at
  LOOP
    BEGIN
      PERFORM public.void_payment(v_pay.id, COALESCE(_reason,'invoice_cancelled'));
      v_voided_payments := v_voided_payments + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO error_logs(source, severity, error_message, context)
      VALUES ('cancel_invoice','warning', SQLERRM,
              jsonb_build_object('invoice_id', _invoice_id, 'payment_id', v_pay.id));
    END;
  END LOOP;

  FOR v_item IN
    SELECT reference_type, reference_id
    FROM invoice_items
    WHERE invoice_id = _invoice_id
      AND reference_type = 'pt_package'
      AND reference_id IS NOT NULL
  LOOP
    SELECT * INTO v_pkg FROM member_pt_packages
    WHERE id = v_item.reference_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_pkg.status = 'pending_payment' THEN
      PERFORM public.cancel_pending_pt_package(v_pkg.id, COALESCE(_reason,'invoice_cancelled'));
    ELSIF v_pkg.status IN ('active','expired','exhausted') THEN
      UPDATE member_pt_packages
        SET status = 'cancelled',
            sessions_remaining = 0,
            updated_at = now()
      WHERE id = v_pkg.id;
    END IF;
    v_cancelled_packages := v_cancelled_packages + 1;

    UPDATE trainer_commissions
      SET status = 'reversed',
          notes = COALESCE(notes,'') ||
                  ' | reversed: invoice_cancelled ' || COALESCE(_reason,'')
    WHERE pt_package_id = v_pkg.id
      AND status IN ('pending','approved');
    GET DIAGNOSTICS v_reversed_commissions = ROW_COUNT;
  END LOOP;

  UPDATE invoices
    SET status = 'cancelled',
        refund_reason = COALESCE(_reason,'invoice_cancelled'),
        refunded_at = now(),
        refunded_by = v_uid,
        updated_at = now()
  WHERE id = _invoice_id;

  BEGIN
    SELECT NULLIF(full_name,'') INTO v_actor_name FROM public.profiles WHERE id = v_uid;
    INSERT INTO public.audit_logs(
      user_id, actor_name, action, table_name, record_id, branch_id,
      old_data, new_data, action_description
    )
    VALUES (
      v_uid, COALESCE(v_actor_name,'System'), 'cancel_invoice', 'invoices', _invoice_id, v_inv.branch_id,
      jsonb_build_object('status', v_inv.status, 'total_amount', v_inv.total_amount, 'amount_paid', v_inv.amount_paid),
      jsonb_build_object(
        'reason', _reason,
        'voided_payments', v_voided_payments,
        'cancelled_packages', v_cancelled_packages,
        'reversed_commissions', v_reversed_commissions
      ),
      'Invoice ' || COALESCE(v_inv.invoice_number,'') || ' cancelled: ' || COALESCE(_reason,'')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', _invoice_id,
    'voided_payments', v_voided_payments,
    'cancelled_packages', v_cancelled_packages,
    'reversed_commissions', v_reversed_commissions
  );
END;
$function$;