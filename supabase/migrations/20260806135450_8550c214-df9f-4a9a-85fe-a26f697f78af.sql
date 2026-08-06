-- 1) Reactivate membership whenever money lands on its invoice (any path)
CREATE OR REPLACE FUNCTION public.tg_reactivate_membership_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('voided'::public.payment_status, 'refunded'::public.payment_status, 'failed'::public.payment_status) THEN
    RETURN NEW;
  END IF;
  IF NEW.lifecycle_status = 'voided'::public.payment_transaction_status THEN RETURN NEW; END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND OR v_invoice.status = 'cancelled'::public.invoice_status THEN RETURN NEW; END IF;
  IF COALESCE(v_invoice.amount_paid, 0) <= 0 THEN RETURN NEW; END IF;

  UPDATE public.memberships m
     SET status = 'active'::public.membership_status,
         updated_at = now()
   WHERE m.status = 'pending'::public.membership_status
     AND m.id IN (
       SELECT ii.reference_id FROM public.invoice_items ii
        WHERE ii.invoice_id = NEW.invoice_id
          AND ii.reference_type = 'membership'
          AND ii.reference_id IS NOT NULL
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reactivate_membership_on_payment ON public.payments;
CREATE TRIGGER trg_reactivate_membership_on_payment
AFTER INSERT OR UPDATE OF status, lifecycle_status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_reactivate_membership_on_payment();

-- 2) void_payment: mark as VOIDED (not refunded); only pause plan when invoice has zero money left
CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id uuid, p_reason text DEFAULT 'Voided'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_new_amount_paid numeric;
  v_new_status public.invoice_status;
  v_new_balance numeric;
  v_void_ratio numeric;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment not found'); END IF;

  IF v_payment.lifecycle_status = 'voided'::public.payment_transaction_status
     OR v_payment.status IN ('refunded'::public.payment_status, 'voided'::public.payment_status) THEN
    RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id, 'idempotent', true);
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_payment.invoice_id FOR UPDATE;

  IF v_payment.payment_method = 'wallet'::public.payment_method THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE member_id = v_payment.member_id FOR UPDATE;
    IF FOUND THEN
      v_new_balance := COALESCE(v_wallet.balance, 0) + COALESCE(v_payment.amount, 0);
      INSERT INTO public.wallet_transactions (
        wallet_id, txn_type, amount, balance_after, description, reference_type, reference_id, created_by
      ) VALUES (
        v_wallet.id, 'credit', v_payment.amount, v_new_balance,
        'Reversal of voided payment', 'payment', v_payment.id, auth.uid()
      );
      UPDATE public.wallets
         SET balance = v_new_balance,
             total_credited = COALESCE(total_credited, 0) + COALESCE(v_payment.amount, 0),
             updated_at = now()
       WHERE id = v_wallet.id;
    END IF;
  END IF;

  v_new_amount_paid := GREATEST(COALESCE(v_invoice.amount_paid, 0) - COALESCE(v_payment.amount, 0), 0);
  IF v_new_amount_paid >= COALESCE(v_invoice.total_amount, 0) THEN v_new_status := 'paid'::public.invoice_status;
  ELSIF v_new_amount_paid > 0 THEN v_new_status := 'partial'::public.invoice_status;
  ELSE v_new_status := 'pending'::public.invoice_status;
  END IF;

  UPDATE public.payments
     SET status = 'voided'::public.payment_status,
         lifecycle_status = 'voided'::public.payment_transaction_status,
         void_reason = p_reason, voided_at = now(), voided_by = auth.uid(),
         lifecycle_metadata = COALESCE(lifecycle_metadata, '{}'::jsonb)
           || jsonb_build_object('void_reason', p_reason, 'reversal_kind', 'void')
   WHERE id = p_payment_id;

  UPDATE public.invoices
     SET amount_paid = v_new_amount_paid, status = v_new_status, updated_at = now()
   WHERE id = v_invoice.id;

  IF v_payment.invoice_id IS NOT NULL THEN
    UPDATE public.payment_transactions
       SET lifecycle_status = 'voided'::public.payment_transaction_status,
           status = 'cancelled', updated_at = now()
     WHERE settled_payment_id = p_payment_id;
  END IF;

  -- Only pause the plan when NOTHING is left paid against the invoice.
  IF v_payment.member_id IS NOT NULL THEN
    IF v_new_amount_paid <= 0 THEN
      UPDATE public.memberships
         SET status = 'pending'::public.membership_status, updated_at = now()
       WHERE id IN (
         SELECT ii.reference_id FROM public.invoice_items ii
          WHERE ii.invoice_id = v_payment.invoice_id
            AND ii.reference_type = 'membership' AND ii.reference_id IS NOT NULL
       ) AND status = 'active'::public.membership_status;
    END IF;
    PERFORM public.evaluate_member_access_state(v_payment.member_id, auth.uid(), p_reason, true);
  END IF;

  IF COALESCE(v_invoice.total_amount, 0) > 0 THEN
    v_void_ratio := LEAST(COALESCE(v_payment.amount,0) / v_invoice.total_amount, 1.0);
  ELSE v_void_ratio := 1.0; END IF;
  PERFORM public.void_trainer_commission(p_payment_id, v_void_ratio, 'Auto-reversed: ' || p_reason);

  INSERT INTO public.payment_lifecycle_events (
    branch_id, payment_id, invoice_id, member_id, actor_user_id,
    event_type, previous_state, new_state, source, metadata
  ) VALUES (
    v_payment.branch_id, v_payment.id, v_payment.invoice_id, v_payment.member_id, auth.uid(),
    'payment_voided', v_invoice.status::text, v_new_status::text, 'void_payment',
    jsonb_build_object('reason', p_reason, 'commission_ratio', v_void_ratio, 'reversal_kind', 'void')
  );

  RETURN jsonb_build_object(
    'success', true, 'payment_id', p_payment_id, 'reversal_kind', 'void',
    'voided_amount', v_payment.amount, 'invoice_new_status', v_new_status,
    'commission_void_ratio', v_void_ratio
  );
END;
$$;

-- 3) Due-date management RPC
CREATE OR REPLACE FUNCTION public.set_invoice_due_date(
  p_invoice_id uuid,
  p_due_date date,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inv public.invoices%ROWTYPE;
  v_actor_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_capability(v_actor, 'approve_discount') THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only owners/admins/managers may change due dates' USING ERRCODE = '42501';
  END IF;
  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'DUE_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.status = 'cancelled'::public.invoice_status THEN
    RAISE EXCEPTION 'CANNOT_SET_DUE_DATE_ON_CANCELLED_INVOICE' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
     SET payment_due_date = p_due_date,
         due_date = p_due_date,
         next_reminder_at = NULL,
         updated_at = now()
   WHERE id = p_invoice_id;

  BEGIN
    SELECT NULLIF(full_name,'') INTO v_actor_name FROM public.profiles WHERE id = v_actor;
    INSERT INTO public.audit_logs (
      user_id, actor_name, action, table_name, record_id, branch_id,
      old_data, new_data, action_description
    ) VALUES (
      v_actor, COALESCE(v_actor_name,'System'), 'invoice_due_date_set', 'invoices', p_invoice_id, v_inv.branch_id,
      jsonb_build_object('due_date', v_inv.due_date, 'payment_due_date', v_inv.payment_due_date),
      jsonb_build_object('due_date', p_due_date, 'payment_due_date', p_due_date, 'reason', p_reason),
      'Due date for invoice ' || COALESCE(v_inv.invoice_number,'') || ' set to ' || p_due_date::text
        || COALESCE(': ' || NULLIF(trim(p_reason),''), '')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'due_date', p_due_date);
END;
$$;

REVOKE ALL ON FUNCTION public.set_invoice_due_date(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_due_date(uuid, date, text) TO authenticated;

-- 4) Reconciliation guardrail: paused plan with money paid on its invoice
CREATE OR REPLACE FUNCTION public.reconcile_payments_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_inv record;
  v_checked int := 0;
  v_wallet_drift int := 0;
  v_stalled int := 0;
BEGIN
  FOR v_inv IN
    SELECT DISTINCT i.id
      FROM public.invoices i
     WHERE i.created_at::date >= v_run_date - 30
        OR i.id IN (SELECT reference_id FROM public.reconciliation_findings
                     WHERE resolved_at IS NULL AND reference_type = 'invoice')
  LOOP
    PERFORM public.recheck_invoice_reconciliation(v_inv.id);
    v_checked := v_checked + 1;
  END LOOP;

  FOR v_inv IN
    WITH agg AS (
      SELECT w.id, w.member_id, w.balance AS recorded,
             COALESCE(SUM(CASE WHEN wt.txn_type IN ('credit','refund')
                               THEN wt.amount ELSE -wt.amount END), 0) AS actual
        FROM public.wallets w
        LEFT JOIN public.wallet_transactions wt ON wt.wallet_id = w.id
       GROUP BY w.id, w.member_id, w.balance
    )
    SELECT * FROM agg
  LOOP
    IF ABS(v_inv.actual - v_inv.recorded) > 0.01 THEN
      PERFORM public.upsert_reconciliation_finding(
        'wallet_drift', 'warn', NULL, 'wallet', v_inv.id,
        jsonb_build_object('recorded', v_inv.recorded, 'actual', v_inv.actual,
                           'delta', v_inv.actual - v_inv.recorded, 'member_id', v_inv.member_id));
      v_wallet_drift := v_wallet_drift + 1;
    ELSE
      PERFORM public.resolve_reconciliation_finding('wallet_drift', 'wallet', v_inv.id);
    END IF;
  END LOOP;

  -- Stalled membership activation: plan pending but its invoice has money against it
  FOR v_inv IN
    SELECT m.id AS membership_id, m.branch_id, m.member_id, m.status,
           i.id AS invoice_id, i.invoice_number, i.amount_paid, i.total_amount
      FROM public.memberships m
      JOIN public.invoice_items ii
        ON ii.reference_type = 'membership' AND ii.reference_id = m.id
      JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE m.status = 'pending'::public.membership_status
       AND i.status <> 'cancelled'::public.invoice_status
       AND COALESCE(i.amount_paid, 0) > 0
  LOOP
    PERFORM public.upsert_reconciliation_finding(
      'stalled_membership_activation', 'error', v_inv.branch_id, 'membership', v_inv.membership_id,
      jsonb_build_object('invoice_id', v_inv.invoice_id, 'invoice_number', v_inv.invoice_number,
                         'amount_paid', v_inv.amount_paid, 'total_amount', v_inv.total_amount,
                         'member_id', v_inv.member_id));
    v_stalled := v_stalled + 1;
  END LOOP;

  PERFORM public.resolve_reconciliation_finding('stalled_membership_activation', 'membership', f.reference_id)
     FROM public.reconciliation_findings f
    WHERE f.kind = 'stalled_membership_activation'
      AND f.resolved_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships m
         WHERE m.id = f.reference_id AND m.status = 'pending'::public.membership_status
      );

  RETURN jsonb_build_object('run_date', v_run_date,
                            'invoices_checked', v_checked,
                            'wallet_drift', v_wallet_drift,
                            'stalled_membership_activations', v_stalled);
END;
$$;