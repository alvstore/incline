ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY['stock_in','sale','adjustment','return','initial','adjust_in','adjust_out','sale_return']::text[]));