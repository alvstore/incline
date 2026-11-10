-- Every sellable, non-batch, non-parent product gets a stock row (qty 0) per branch,
-- so the POS sale guard refuses items with nothing on the shelf instead of selling untracked units.
CREATE OR REPLACE FUNCTION public.ensure_product_inventory_rows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.is_variant_parent, false) OR COALESCE(NEW.requires_batch_tracking, false) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.inventory (product_id, branch_id, quantity)
  SELECT NEW.id, b.id, 0 FROM public.branches b
  WHERE NEW.branch_id IS NULL OR b.id = NEW.branch_id
  ON CONFLICT (product_id, branch_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.ensure_product_inventory_rows() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ensure_product_inventory_rows ON public.products;
CREATE TRIGGER trg_ensure_product_inventory_rows
AFTER INSERT OR UPDATE OF branch_id, is_variant_parent, requires_batch_tracking ON public.products
FOR EACH ROW EXECUTE FUNCTION public.ensure_product_inventory_rows();

INSERT INTO public.inventory (product_id, branch_id, quantity)
SELECT p.id, b.id, 0 FROM public.products p
JOIN public.branches b ON p.branch_id IS NULL OR b.id = p.branch_id
WHERE NOT COALESCE(p.is_variant_parent, false) AND NOT COALESCE(p.requires_batch_tracking, false)
ON CONFLICT (product_id, branch_id) DO NOTHING;