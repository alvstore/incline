
-- ─────────────────────────────────────────────────────────────
-- cancel_invoice(_invoice_id uuid, _reason text)
-- Single atomic entry point for invoice cancellation.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_invoice(
  _invoice_id uuid,
  _reason text DEFAULT 'manual_cancel'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv invoices%ROWTYPE;
  v_pay record;
  v_item record;
  v_pkg record;
  v_voided_payments int := 0;
  v_reversed_commissions int := 0;
  v_cancelled_packages int := 0;
BEGIN
  -- Auth gate: owner/admin/manager only. Allow system (no auth.uid) callers
  -- (used by the auto-cascade trigger below) to pass through.
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

  -- 1. Void every non-voided payment on this invoice.
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
      -- Best-effort: log and continue.
      INSERT INTO error_logs(source, severity, error_message, context)
      VALUES ('cancel_invoice','warning', SQLERRM,
              jsonb_build_object('invoice_id', _invoice_id, 'payment_id', v_pay.id));
    END;
  END LOOP;

  -- 2. Walk items: cancel linked PT packages + reverse trainer commissions.
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

    -- Reverse any still-open trainer commissions for this package.
    UPDATE trainer_commissions
      SET status = 'reversed',
          notes = COALESCE(notes,'') ||
                  ' | reversed: invoice_cancelled ' || COALESCE(_reason,'')
    WHERE pt_package_id = v_pkg.id
      AND status IN ('pending','approved');
    GET DIAGNOSTICS v_reversed_commissions = ROW_COUNT;
  END LOOP;

  -- 3. Mark invoice cancelled.
  UPDATE invoices
    SET status = 'cancelled',
        refund_reason = COALESCE(_reason,'invoice_cancelled'),
        refunded_at = now(),
        refunded_by = v_uid,
        updated_at = now()
  WHERE id = _invoice_id;

  -- 4. Audit trail (best effort — don't fail if table shape changes).
  BEGIN
    INSERT INTO audit_logs(entity_type, entity_id, action, actor_user_id, metadata, branch_id)
    VALUES ('invoice', _invoice_id, 'cancel_invoice', v_uid,
            jsonb_build_object(
              'reason', _reason,
              'voided_payments', v_voided_payments,
              'cancelled_packages', v_cancelled_packages,
              'reversed_commissions', v_reversed_commissions
            ),
            v_inv.branch_id);
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
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Safety-net trigger: when a PT-linked payment goes refunded/failed
-- and no live payments remain, auto-cascade to invoice + package + commissions.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_pt_payment_cascade_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_live boolean;
  v_is_pt boolean;
  v_inv_status invoice_status;
BEGIN
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('refunded','failed') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Only fire when the invoice is PT-related.
  SELECT EXISTS(
    SELECT 1 FROM invoice_items
    WHERE invoice_id = NEW.invoice_id AND reference_type = 'pt_package'
  ) INTO v_is_pt;
  IF NOT v_is_pt THEN RETURN NEW; END IF;

  SELECT status INTO v_inv_status FROM invoices WHERE id = NEW.invoice_id;
  IF v_inv_status IN ('cancelled','refunded') THEN RETURN NEW; END IF;

  SELECT EXISTS(
    SELECT 1 FROM payments
    WHERE invoice_id = NEW.invoice_id
      AND status NOT IN ('refunded','failed')
  ) INTO v_has_live;

  IF NOT v_has_live THEN
    PERFORM public.cancel_invoice(NEW.invoice_id, 'auto_cascade_after_payment_void');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pt_payment_cascade_cancel ON public.payments;
CREATE TRIGGER pt_payment_cascade_cancel
  AFTER UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_pt_payment_cascade_cancel();

-- ─────────────────────────────────────────────────────────────
-- One-time cleanup for Priyanka Lohar (INC-26-0043)
-- Invoice INV-INC-26-0054 / PT package ba4ca486…
-- Payment already voided; just needs cascade.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.cancel_invoice(
    'f3ddb3b4-9bd1-44d5-bfd1-d5b6c1d0a950'::uuid,
    'backfill_wrong_pt_sale_priyanka_lohar'
  ) INTO v_result;
  RAISE NOTICE 'Priyanka cleanup: %', v_result;
END $$;
