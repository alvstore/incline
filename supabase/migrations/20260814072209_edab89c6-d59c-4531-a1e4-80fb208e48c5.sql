-- Audit POS Sales and Hardening Trigger Logic
-- Version 1.1.1: Ensures POS sales payment_status is synced with Invoice status

CREATE OR REPLACE FUNCTION public.sync_pos_status_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sync POS status when invoice status changes
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) OR (TG_OP = 'INSERT') THEN
    UPDATE public.pos_sales
    SET payment_status = CASE 
        WHEN NEW.status = 'paid' THEN 'paid'
        WHEN NEW.status = 'cancelled' THEN 'cancelled'
        WHEN NEW.status = 'refunded' THEN 'refunded'
        WHEN NEW.status = 'partial' THEN 'partial'
        ELSE payment_status 
      END
    WHERE invoice_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop if exists and recreate trigger
DROP TRIGGER IF EXISTS tg_sync_pos_status_from_invoice ON public.invoices;
CREATE TRIGGER tg_sync_pos_status_from_invoice
AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.sync_pos_status_from_invoice();

-- Backfill existing POS statuses based on their invoices (Fixed: removed non-existent 'completed' enum)
UPDATE public.pos_sales ps
SET payment_status = CASE 
    WHEN i.status = 'paid' THEN 'paid'
    WHEN i.status = 'cancelled' THEN 'cancelled'
    WHEN i.status = 'refunded' THEN 'refunded'
    WHEN i.status = 'partial' THEN 'partial'
    ELSE ps.payment_status
  END
FROM public.invoices i
WHERE ps.invoice_id = i.id
  AND ps.payment_status <> 'cancelled'
  AND i.status IN ('paid', 'cancelled', 'refunded', 'partial');

-- Harden cancel_invoice to explicitly handle POS sales just in case
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

  -- Handle POS sales specifically
  UPDATE public.pos_sales 
  SET payment_status = 'cancelled'
  WHERE invoice_id = _invoice_id;

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
