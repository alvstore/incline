ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hsn_code text, ADD COLUMN IF NOT EXISTS is_sellable boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.products.is_sellable IS 'False until staff add photo + selling price; store/POS only list sellable products';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS vendor_gstin text, ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2), ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2), ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2), ADD COLUMN IF NOT EXISTS igst_amount numeric(12,2), ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2);
CREATE UNIQUE INDEX IF NOT EXISTS expenses_vendor_bill_unique ON public.expenses (branch_id, upper(vendor_gstin), bill_number) WHERE expense_type = 'vendor_bill' AND vendor_gstin IS NOT NULL AND bill_number IS NOT NULL;

CREATE TABLE public.expense_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  product_id uuid REFERENCES public.products(id),
  batch_id uuid REFERENCES public.product_batches(id),
  item_name text NOT NULL,
  hsn_code text,
  quantity numeric(12,2) NOT NULL,
  rate numeric(12,2) NOT NULL,
  taxable_amount numeric(12,2) NOT NULL,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  cgst_amount numeric(12,2) NOT NULL DEFAULT 0,
  sgst_amount numeric(12,2) NOT NULL DEFAULT 0,
  igst_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_items_expense_idx ON public.expense_items(expense_id);
CREATE INDEX expense_items_branch_idx ON public.expense_items(branch_id);
GRANT SELECT ON public.expense_items TO authenticated;
GRANT ALL ON public.expense_items TO service_role;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and branch managers read purchase lines" ON public.expense_items FOR SELECT TO authenticated
USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[])) OR branch_id IN (SELECT public.managed_branch_ids(auth.uid())));

CREATE OR REPLACE FUNCTION public.import_purchase_bill(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid := (p_payload->>'branch_id')::uuid;
  v_bill jsonb; v_line jsonb;
  v_exp uuid; v_prod uuid; v_batch uuid;
  v_cat uuid;
  v_bills int := 0; v_lines int := 0; v_new int := 0;
  v_tax numeric; v_rate numeric; v_gst numeric; v_half numeric; v_qty numeric;
  v_t_tax numeric; v_t_c numeric; v_t_s numeric; v_t_tot numeric;
  v_paid boolean := coalesce((p_payload->>'is_paid')::boolean, false);
BEGIN
  IF public.rpc_guard_applies('import_purchase_bill') THEN
    IF NOT ((SELECT public.has_any_role(v_uid, ARRAY['owner','admin']::app_role[])) OR public.manages_branch(v_uid, v_branch)) THEN
      RAISE EXCEPTION 'forbidden: only owner, admin or branch manager can import purchase bills' USING ERRCODE='42501';
    END IF;
  END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'branch_id required'; END IF;
  IF coalesce((SELECT value::text FROM public.settings WHERE branch_id IS NULL AND key='purchase_bill_import' LIMIT 1),'true') ILIKE '%false%' THEN
    RAISE EXCEPTION 'Purchase bill import is switched off';
  END IF;
  SELECT id INTO v_cat FROM public.expense_categories WHERE name='Retail Inventory' LIMIT 1;

  FOR v_bill IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'bills','[]'::jsonb)) LOOP
    IF coalesce(v_bill->>'bill_number','')='' OR coalesce(v_bill->>'vendor','')='' THEN RAISE EXCEPTION 'Bill number and vendor are required'; END IF;
    IF EXISTS (SELECT 1 FROM public.expenses WHERE branch_id=v_branch AND expense_type='vendor_bill' AND bill_number=v_bill->>'bill_number'
               AND upper(coalesce(vendor_gstin,''))=upper(coalesce(v_bill->>'vendor_gstin',''))) THEN
      RAISE EXCEPTION 'Bill % from % is already imported', v_bill->>'bill_number', v_bill->>'vendor';
    END IF;
    v_t_tax:=0; v_t_c:=0; v_t_s:=0; v_t_tot:=0;
    INSERT INTO public.expenses(branch_id, category_id, expense_type, description, amount, expense_date, vendor, vendor_gstin, bill_number,
      status, submitted_by, approved_by, approved_at, is_paid, paid_at, paid_by, payment_method)
    VALUES (v_branch, v_cat, 'vendor_bill', 'Stock purchase — '||(v_bill->>'vendor')||' bill '||(v_bill->>'bill_number'), 0,
      (v_bill->>'bill_date')::date, v_bill->>'vendor', nullif(upper(v_bill->>'vendor_gstin'),''), v_bill->>'bill_number',
      'approved', v_uid, v_uid, now(), v_paid, CASE WHEN v_paid THEN coalesce((p_payload->>'paid_date')::timestamptz, now()) END,
      CASE WHEN v_paid THEN v_uid END, CASE WHEN v_paid THEN (p_payload->>'payment_method')::payment_method END)
    RETURNING id INTO v_exp;

    FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(v_bill->'lines','[]'::jsonb)) LOOP
      v_qty := (v_line->>'quantity')::numeric; v_rate := (v_line->>'rate')::numeric; v_gst := coalesce((v_line->>'gst_rate')::numeric,0);
      IF v_qty IS NULL OR v_qty<=0 OR v_rate IS NULL OR v_rate<0 THEN RAISE EXCEPTION 'Invalid quantity/rate for %', v_line->>'item_name'; END IF;
      IF v_gst NOT IN (0,5,12,18,28) THEN RAISE EXCEPTION 'Invalid GST rate for %', v_line->>'item_name'; END IF;
      v_tax := round(v_qty*v_rate,2); v_half := round(v_tax*v_gst/200,2);
      v_prod := nullif(v_line->>'product_id','')::uuid;
      IF v_prod IS NULL THEN
        INSERT INTO public.products(name, price, cost_price, tax_rate, hsn_code, branch_id, is_active, is_sellable, requires_batch_tracking, category)
        VALUES (v_line->>'item_name', 0, v_rate, v_gst, nullif(v_line->>'hsn_code',''), v_branch, true, false, true, 'Supplements')
        RETURNING id INTO v_prod; v_new := v_new+1;
      ELSE
        UPDATE public.products SET cost_price=v_rate, hsn_code=coalesce(nullif(v_line->>'hsn_code',''),hsn_code) WHERE id=v_prod;
      END IF;
      INSERT INTO public.product_batches(product_id, branch_id, batch_number, quantity_received, quantity_remaining, cost_price, supplier, invoice_ref, mfg_date, created_by)
      VALUES (v_prod, v_branch, 'PB-'||(v_bill->>'bill_number')||'-'||lpad((v_lines+1)::text,3,'0')||'-'||substr(gen_random_uuid()::text,1,4),
        v_qty::int, v_qty::int, v_rate, v_bill->>'vendor', v_bill->>'bill_number', (v_bill->>'bill_date')::date, v_uid)
      RETURNING id INTO v_batch;
      INSERT INTO public.inventory(product_id, branch_id, quantity, last_restocked_at) VALUES (v_prod, v_branch, v_qty::int, now())
      ON CONFLICT (product_id, branch_id) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, last_restocked_at = now(), updated_at = now();
      INSERT INTO public.expense_items(expense_id, branch_id, product_id, batch_id, item_name, hsn_code, quantity, rate, taxable_amount, gst_rate, cgst_amount, sgst_amount, total_amount)
      VALUES (v_exp, v_branch, v_prod, v_batch, v_line->>'item_name', nullif(v_line->>'hsn_code',''), v_qty, v_rate, v_tax, v_gst, v_half, v_half, v_tax+2*v_half);
      v_t_tax:=v_t_tax+v_tax; v_t_c:=v_t_c+v_half; v_t_s:=v_t_s+v_half; v_lines:=v_lines+1;
    END LOOP;
    v_t_tot := coalesce(nullif(v_bill->>'bill_total','')::numeric, v_t_tax+v_t_c+v_t_s);
    UPDATE public.expenses SET amount=round(v_t_tot,2), taxable_amount=v_t_tax, cgst_amount=v_t_c, sgst_amount=v_t_s, igst_amount=0,
      gst_rate = (SELECT max(gst_rate) FROM public.expense_items WHERE expense_id=v_exp) WHERE id=v_exp;
    v_bills := v_bills+1;
  END LOOP;
  RETURN jsonb_build_object('bills', v_bills, 'lines', v_lines, 'new_products', v_new);
END $$;
REVOKE EXECUTE ON FUNCTION public.import_purchase_bill(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_purchase_bill(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_products_sellable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_sellable AND (TG_OP='INSERT' OR OLD.is_sellable IS DISTINCT FROM true) THEN
    IF coalesce(NEW.price,0) <= 0 OR coalesce(NEW.image_url,'') = '' THEN
      RAISE EXCEPTION 'Add a photo and a selling price before making this product available for sale';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_products_sellable_guard BEFORE INSERT OR UPDATE OF is_sellable ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_products_sellable_guard();