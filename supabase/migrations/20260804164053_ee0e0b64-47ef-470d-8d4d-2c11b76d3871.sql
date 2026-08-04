-- 1. Schema: findings become live state
ALTER TABLE public.reconciliation_findings
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolution text;

-- Collapse existing duplicates: keep the newest open row per (kind, ref), fold the rest in
WITH ranked AS (
  SELECT id, kind, reference_type, reference_id, created_at,
         row_number() OVER (PARTITION BY kind, reference_type, reference_id ORDER BY created_at DESC) AS rn,
         count(*)     OVER (PARTITION BY kind, reference_type, reference_id) AS cnt,
         min(created_at) OVER (PARTITION BY kind, reference_type, reference_id) AS first_at
    FROM public.reconciliation_findings
   WHERE resolved_at IS NULL
)
UPDATE public.reconciliation_findings f
   SET occurrence_count = r.cnt,
       first_seen_at = r.first_at,
       last_seen_at = r.created_at
  FROM ranked r
 WHERE f.id = r.id AND r.rn = 1;

UPDATE public.reconciliation_findings f
   SET resolved_at = now(), resolution = 'merged'
  FROM (
    SELECT id, row_number() OVER (PARTITION BY kind, reference_type, reference_id ORDER BY created_at DESC) AS rn
      FROM public.reconciliation_findings WHERE resolved_at IS NULL
  ) r
 WHERE f.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_findings_open_key
  ON public.reconciliation_findings (kind, reference_type, reference_id)
  WHERE resolved_at IS NULL;

-- 2. Helpers
CREATE OR REPLACE FUNCTION public.upsert_reconciliation_finding(
  p_kind text, p_severity text, p_branch_id uuid,
  p_reference_type text, p_reference_id uuid, p_details jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.reconciliation_findings
    (run_date, kind, severity, branch_id, reference_type, reference_id, details,
     occurrence_count, first_seen_at, last_seen_at)
  VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, p_kind, p_severity, p_branch_id,
          p_reference_type, p_reference_id, p_details, 1, now(), now())
  ON CONFLICT (kind, reference_type, reference_id) WHERE resolved_at IS NULL
  DO UPDATE SET details = EXCLUDED.details,
                severity = EXCLUDED.severity,
                branch_id = EXCLUDED.branch_id,
                run_date = EXCLUDED.run_date,
                last_seen_at = now(),
                occurrence_count = public.reconciliation_findings.occurrence_count + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_reconciliation_finding(
  p_kind text, p_reference_type text, p_reference_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.reconciliation_findings
     SET resolved_at = now(), resolution = 'auto'
   WHERE resolved_at IS NULL
     AND kind = p_kind
     AND reference_type = p_reference_type
     AND reference_id = p_reference_id;
$$;

-- 3. Single-invoice recheck: payment drift, line-item drift, tax drift
CREATE OR REPLACE FUNCTION public.recheck_invoice_reconciliation(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv record;
  v_paid numeric;
  v_reversed numeric;
  v_net_paid numeric;
  v_items_total numeric;
  v_items_tax numeric;
  v_item_count int;
  v_bad_rate int;
  v_findings text[] := '{}';
BEGIN
  SELECT id, branch_id, status, amount_paid, total_amount, tax_amount
    INTO v_inv
    FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  -- Cancelled invoices are not reconciled
  IF v_inv.status = 'cancelled'::invoice_status THEN
    PERFORM public.resolve_reconciliation_finding('invoice_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
    RETURN jsonb_build_object('found', true, 'skipped', 'cancelled');
  END IF;

  -- ---- payment ledger drift (net of reversals) ----
  SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'::payment_status), 0),
         COALESCE(SUM(p.amount) FILTER (WHERE p.reversal_of IS NOT NULL), 0)
    INTO v_paid, v_reversed
    FROM public.payments p
   WHERE p.invoice_id = p_invoice_id;

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

  -- ---- line item + tax drift ----
  SELECT count(*),
         COALESCE(SUM(ii.total_amount), 0),
         COALESCE(SUM(ii.tax_amount), 0),
         count(*) FILTER (
           WHERE ii.tax_rate IS NOT NULL
             AND ABS(COALESCE(ii.tax_amount, 0)
                     - ROUND(COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)
                             * COALESCE(ii.tax_rate, 0) / 100.0, 2)) > 1.00)
    INTO v_item_count, v_items_total, v_items_tax, v_bad_rate
    FROM public.invoice_items ii
   WHERE ii.invoice_id = p_invoice_id;

  IF v_item_count > 0 THEN
    IF ABS(v_items_total - COALESCE(v_inv.total_amount, 0)) > 0.01 THEN
      PERFORM public.upsert_reconciliation_finding(
        'invoice_items_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
        jsonb_build_object('recorded', v_inv.total_amount, 'actual', v_items_total,
                           'delta', v_items_total - COALESCE(v_inv.total_amount, 0),
                           'item_count', v_item_count));
      v_findings := v_findings || ARRAY['invoice_items_drift'];
    ELSE
      PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    END IF;

    IF ABS(v_items_tax - COALESCE(v_inv.tax_amount, 0)) > 0.01 OR v_bad_rate > 0 THEN
      PERFORM public.upsert_reconciliation_finding(
        'invoice_tax_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
        jsonb_build_object('recorded', v_inv.tax_amount, 'actual', v_items_tax,
                           'delta', v_items_tax - COALESCE(v_inv.tax_amount, 0),
                           'bad_rate_lines', v_bad_rate));
      v_findings := v_findings || ARRAY['invoice_tax_drift'];
    ELSE
      PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
    END IF;
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
  END IF;

  RETURN jsonb_build_object('found', true, 'invoice_id', p_invoice_id,
                            'net_paid', v_net_paid, 'items_total', v_items_total,
                            'findings', to_jsonb(v_findings));
END;
$$;

GRANT EXECUTE ON FUNCTION public.recheck_invoice_reconciliation(uuid) TO authenticated, service_role;

-- 4. Triggers: instant recheck on any invoice/item/payment change
CREATE OR REPLACE FUNCTION public.tg_recheck_invoice_reconciliation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    v_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;
  IF v_id IS NOT NULL THEN
    PERFORM public.recheck_invoice_reconciliation(v_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recheck_recon_invoices ON public.invoices;
CREATE CONSTRAINT TRIGGER trg_recheck_recon_invoices
  AFTER INSERT OR UPDATE OF total_amount, tax_amount, amount_paid, status ON public.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recheck_invoice_reconciliation();

DROP TRIGGER IF EXISTS trg_recheck_recon_invoice_items ON public.invoice_items;
CREATE CONSTRAINT TRIGGER trg_recheck_recon_invoice_items
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recheck_invoice_reconciliation();

DROP TRIGGER IF EXISTS trg_recheck_recon_payments ON public.payments;
CREATE CONSTRAINT TRIGGER trg_recheck_recon_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recheck_invoice_reconciliation();

-- 5. Daily job rewritten on top of the shared checker
CREATE OR REPLACE FUNCTION public.reconcile_payments_daily()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_run_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_inv record;
  v_checked int := 0;
  v_wallet_drift int := 0;
BEGIN
  -- Re-evaluate every invoice touched recently plus every invoice with an open finding
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

  -- Wallet balance drift
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

  RETURN jsonb_build_object('run_date', v_run_date,
                            'invoices_checked', v_checked,
                            'wallet_drift', v_wallet_drift);
END;
$$;

-- 6. Clear the current backlog immediately
SELECT public.reconcile_payments_daily();

-- 7. Live updates on the System Health card
ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_findings;
ALTER TABLE public.reconciliation_findings REPLICA IDENTITY FULL;