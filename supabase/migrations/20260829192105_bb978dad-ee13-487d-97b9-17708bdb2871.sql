-- 1. Proforma flag
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_proforma boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoices_proforma ON public.invoices (is_proforma) WHERE is_proforma;

-- 2. Numbering: proformas get their own non-statutory PRO series
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_code TEXT;
  v_yy          TEXT;
  v_seq         INTEGER;
  v_series      TEXT;
BEGIN
  SELECT code INTO v_branch_code FROM public.branches WHERE id = NEW.branch_id;
  IF v_branch_code IS NULL THEN
    v_branch_code := 'X';
  END IF;
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');

  -- Proforma / renewal offers are NOT statutory documents -> separate PRO series
  -- Taxable supplies -> tax invoice series; exempt / non-GST -> bill of supply series
  v_series := CASE
    WHEN COALESCE(NEW.is_proforma, false) THEN 'PRO'
    WHEN COALESCE(NEW.is_gst_invoice, false) THEN 'INV'
    ELSE 'BOS'
  END;

  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (NEW.branch_id, v_yy, v_series, 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  NEW.document_series := v_series;
  NEW.invoice_number := v_series || '-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

-- 3. Conversion: proforma -> real tax invoice (burns an INV/BOS number only now)
CREATE OR REPLACE FUNCTION public.convert_proforma_to_invoice(
  _invoice_id uuid,
  _gst_rate numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv         RECORD;
  v_rate        numeric;
  v_branch_code TEXT;
  v_yy          TEXT;
  v_seq         INTEGER;
  v_series      TEXT;
  v_number      TEXT;
  v_sub         numeric;
  v_tax         numeric;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF NOT COALESCE(v_inv.is_proforma, false) THEN
    RETURN jsonb_build_object('success', true, 'already', true, 'invoice_number', v_inv.invoice_number);
  END IF;

  v_rate := COALESCE(_gst_rate, NULLIF(v_inv.gst_rate, 0), 5);
  v_series := CASE WHEN v_rate > 0 THEN 'INV' ELSE 'BOS' END;

  SELECT code INTO v_branch_code FROM public.branches WHERE id = v_inv.branch_id;
  v_branch_code := COALESCE(v_branch_code, 'X');
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');

  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (v_inv.branch_id, v_yy, v_series, 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  v_number := v_series || '-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');

  -- totals are GST-inclusive
  v_sub := ROUND(v_inv.total_amount / (1 + v_rate / 100.0), 2);
  v_tax := ROUND(v_inv.total_amount - v_sub, 2);

  UPDATE public.invoices
     SET is_proforma     = false,
         invoice_number  = v_number,
         document_series = v_series,
         is_gst_invoice  = (v_rate > 0),
         gst_rate        = v_rate,
         subtotal        = v_sub,
         tax_amount      = v_tax,
         status          = CASE WHEN status = 'draft' THEN 'pending'::invoice_status ELSE status END,
         notes           = COALESCE(NULLIF(notes, '') || E'\n', '') || 'Issued from renewal offer ' || COALESCE(v_inv.invoice_number, ''),
         updated_at      = now()
   WHERE id = _invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', _invoice_id,
    'invoice_number', v_number,
    'series', v_series,
    'gst_rate', v_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_proforma_to_invoice(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_proforma_to_invoice(uuid, numeric) TO authenticated, service_role;

-- 4. Auto-issue the tax invoice the moment a renewal offer is actually paid
CREATE OR REPLACE FUNCTION public.tg_auto_issue_proforma_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rate        numeric;
  v_branch_code TEXT;
  v_yy          TEXT;
  v_seq         INTEGER;
BEGIN
  IF NOT COALESCE(OLD.is_proforma, false) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.amount_paid, 0) <= 0 AND NEW.status NOT IN ('paid','partial') THEN
    RETURN NEW;
  END IF;

  v_rate := COALESCE(NULLIF(NEW.gst_rate, 0), 5);

  SELECT code INTO v_branch_code FROM public.branches WHERE id = NEW.branch_id;
  v_branch_code := COALESCE(v_branch_code, 'X');
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');

  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (NEW.branch_id, v_yy, 'INV', 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  NEW.notes := COALESCE(NULLIF(NEW.notes, '') || E'\n', '') || 'Issued from renewal offer ' || COALESCE(OLD.invoice_number, '');
  NEW.is_proforma     := false;
  NEW.document_series := 'INV';
  NEW.invoice_number  := 'INV-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');
  NEW.is_gst_invoice  := true;
  NEW.gst_rate        := v_rate;
  NEW.subtotal        := ROUND(NEW.total_amount / (1 + v_rate / 100.0), 2);
  NEW.tax_amount      := ROUND(NEW.total_amount - NEW.subtotal, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_issue_proforma_on_payment ON public.invoices;
CREATE TRIGGER trg_auto_issue_proforma_on_payment
BEFORE UPDATE OF amount_paid, status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_auto_issue_proforma_on_payment();

-- 5. Bills of supply are cash/exempt only: block gateway transactions against them
CREATE OR REPLACE FUNCTION public.tg_block_gateway_on_bill_of_supply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_series text;
  v_proforma boolean;
BEGIN
  IF NEW.invoice_id IS NULL OR NEW.gateway IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT document_series, is_proforma INTO v_series, v_proforma
    FROM public.invoices WHERE id = NEW.invoice_id;
  IF COALESCE(v_proforma, false) THEN
    RETURN NEW;
  END IF;
  IF v_series = 'BOS' THEN
    RAISE EXCEPTION 'A bill of supply cannot be collected through a payment gateway. Issue a tax invoice for online payments.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_gateway_on_bill_of_supply ON public.payment_transactions;
CREATE TRIGGER trg_block_gateway_on_bill_of_supply
BEFORE INSERT ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.tg_block_gateway_on_bill_of_supply();

-- 6. Renewal generator: create offers, never statutory invoices; expire stale offers
CREATE OR REPLACE FUNCTION public.generate_renewal_invoices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ms RECORD;
  inv_exists boolean;
  new_invoice_id uuid;
  v_rate numeric := 5;
  v_sub numeric;
  v_tax numeric;
BEGIN
  -- Retire renewal offers that were never taken up (membership already lapsed)
  UPDATE public.invoices i
     SET status = 'cancelled'::invoice_status,
         notes = COALESCE(NULLIF(i.notes, '') || E'\n', '') || 'Renewal offer expired — membership not renewed.',
         updated_at = now()
   WHERE i.is_proforma
     AND i.status IN ('draft','pending')
     AND COALESCE(i.amount_paid, 0) = 0
     AND i.created_at < now() - INTERVAL '14 days';

  FOR ms IN
    SELECT m.id as membership_id, m.member_id, m.branch_id, m.plan_id,
           mp.name as plan_name, mp.price as plan_price,
           mem.user_id
    FROM memberships m
    JOIN membership_plans mp ON m.plan_id = mp.id
    JOIN members mem ON mem.id = m.member_id
    WHERE m.status = 'active'
    AND m.end_date = CURRENT_DATE + INTERVAL '7 days'
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM invoices i
      JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE i.member_id = ms.member_id
      AND ii.reference_type = 'membership_renewal'
      AND i.status IN ('draft','pending')
      AND i.created_at > CURRENT_DATE - INTERVAL '10 days'
    ) INTO inv_exists;

    IF NOT inv_exists THEN
      v_sub := ROUND(ms.plan_price / (1 + v_rate / 100.0), 2);
      v_tax := ROUND(ms.plan_price - v_sub, 2);

      INSERT INTO invoices (
        branch_id, member_id, invoice_number, subtotal, discount_amount,
        tax_amount, total_amount, status, due_date,
        is_proforma, is_gst_invoice, gst_rate, source, invoice_type, notes
      )
      VALUES (
        ms.branch_id, ms.member_id, NULL, v_sub, 0,
        v_tax, ms.plan_price, 'draft', CURRENT_DATE + INTERVAL '7 days',
        true, false, v_rate, 'renewal_offer', 'membership_renewal',
        'Renewal offer — not a tax invoice. A GST invoice is issued automatically on payment.'
      )
      RETURNING id INTO new_invoice_id;

      INSERT INTO invoice_items (invoice_id, description, unit_price, quantity, total_amount, reference_type, reference_id)
      VALUES (new_invoice_id, 'Membership Renewal - ' || ms.plan_name, ms.plan_price, 1, ms.plan_price, 'membership_renewal', ms.membership_id);

      INSERT INTO notifications (user_id, branch_id, title, message, type, category)
      VALUES (ms.user_id, ms.branch_id, 'Renewal Offer Ready',
        'Your membership renewal for ' || ms.plan_name || ' (₹' || ms.plan_price || ') is ready. Pay within 7 days to continue without a break.',
        'info', 'billing');
    END IF;
  END LOOP;
END;
$$;