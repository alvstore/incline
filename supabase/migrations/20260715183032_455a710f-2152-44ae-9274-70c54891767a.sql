
-- 1) Lock down member_pt_packages: split policy into member-SELECT + staff-ALL.
DROP POLICY IF EXISTS staff_access_member_pt ON public.member_pt_packages;

CREATE POLICY member_pt_select_own
  ON public.member_pt_packages
  FOR SELECT
  TO authenticated
  USING (
    member_id = get_member_id(auth.uid())
    OR has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  );

CREATE POLICY staff_write_member_pt
  ON public.member_pt_packages
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]));

-- Members self-purchase continues to work via SECURITY DEFINER RPCs (record_payment, purchase flows)
-- which run as the function owner and bypass RLS. Direct member INSERT/UPDATE/DELETE is now blocked.

-- 2) Enforce price integrity on member-inserted invoice_items via a BEFORE INSERT trigger.
--    Staff/service_role inserts pass through untouched. Member inserts get unit_price
--    overwritten from products.price (when reference_type='product') and totals recomputed.
CREATE OR REPLACE FUNCTION public.enforce_member_invoice_item_pricing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_staff boolean;
  v_owner_member uuid;
  v_product_price numeric;
  v_product_gst numeric;
  v_qty integer;
BEGIN
  -- Bypass for staff / service_role (they may issue any priced invoice)
  v_is_staff := has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]);
  IF v_is_staff OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only allow member inserts on their own invoice
  SELECT member_id INTO v_owner_member FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_owner_member IS NULL OR v_owner_member <> get_member_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to add items to this invoice';
  END IF;

  v_qty := GREATEST(COALESCE(NEW.quantity, 1), 1);

  -- If line references a product, force pricing from the product row.
  IF NEW.reference_type = 'product' AND NEW.reference_id IS NOT NULL THEN
    SELECT price, COALESCE(gst_percentage, 0)
      INTO v_product_price, v_product_gst
      FROM public.products WHERE id = NEW.reference_id;
    IF v_product_price IS NULL THEN
      RAISE EXCEPTION 'Referenced product not found';
    END IF;
    NEW.unit_price := v_product_price;
    NEW.tax_rate   := v_product_gst;
  ELSE
    RAISE EXCEPTION 'Members may only add product-referenced line items';
  END IF;

  NEW.quantity     := v_qty;
  NEW.tax_amount   := ROUND((NEW.unit_price * v_qty) * COALESCE(NEW.tax_rate,0) / 100.0, 2);
  NEW.total_amount := ROUND((NEW.unit_price * v_qty) + NEW.tax_amount, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_member_invoice_item_pricing ON public.invoice_items;
CREATE TRIGGER trg_enforce_member_invoice_item_pricing
BEFORE INSERT ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_invoice_item_pricing();

-- 3) Recompute invoice totals from the (now-trusted) line items whenever a member owns the row.
CREATE OR REPLACE FUNCTION public.recompute_member_invoice_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_staff boolean;
  v_sub numeric;
  v_tax numeric;
BEGIN
  v_is_staff := has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]);
  IF v_is_staff OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(unit_price * quantity),0), COALESCE(SUM(tax_amount),0)
    INTO v_sub, v_tax
    FROM public.invoice_items WHERE invoice_id = NEW.id;

  -- On INSERT there are usually no line items yet; the client is expected to insert items,
  -- then call an RPC or update to finalize. We still zero out any client-supplied fabrications.
  NEW.subtotal        := v_sub;
  NEW.tax_amount      := v_tax;
  NEW.discount_amount := 0;
  NEW.total_amount    := v_sub + v_tax;
  NEW.amount_paid     := 0;
  NEW.status          := COALESCE(NEW.status, 'unpaid'::invoice_status);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_member_invoice_totals ON public.invoices;
CREATE TRIGGER trg_recompute_member_invoice_totals
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.recompute_member_invoice_totals();
