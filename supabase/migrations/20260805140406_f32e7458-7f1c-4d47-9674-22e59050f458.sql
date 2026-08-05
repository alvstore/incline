DROP FUNCTION IF EXISTS public.book_facility_slot(uuid, uuid, uuid, uuid, text, boolean, text);

CREATE OR REPLACE FUNCTION public.enforce_member_invoice_item_pricing()
RETURNS trigger
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
  -- Trusted internal routines (purchase_benefit_credits, purchase_membership, ...)
  -- set app.trusted_invoice and own their own pricing.
  IF COALESCE(current_setting('app.trusted_invoice', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  v_is_staff := has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]);
  IF v_is_staff OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT member_id INTO v_owner_member FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_owner_member IS NULL OR v_owner_member <> get_member_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to add items to this invoice';
  END IF;

  v_qty := GREATEST(COALESCE(NEW.quantity, 1), 1);

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