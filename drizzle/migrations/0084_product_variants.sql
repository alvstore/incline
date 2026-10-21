ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS parent_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_variant_parent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS option_type text,
  ADD COLUMN IF NOT EXISTS option_value text,
  ADD COLUMN IF NOT EXISTS swatch_color text,
  ADD COLUMN IF NOT EXISTS variant_sort integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_parent ON public.products(parent_product_id) WHERE parent_product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_variant_value ON public.products(parent_product_id, lower(option_value)) WHERE parent_product_id IS NOT NULL AND is_active;
COMMENT ON COLUMN public.products.is_variant_parent IS 'Group row holding shared details; never sold directly. Each option is a child product with its own SKU, price, image and stock.';