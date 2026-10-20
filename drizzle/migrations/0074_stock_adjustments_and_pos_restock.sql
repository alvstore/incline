-- Sellable guard: a product can only go on POS with a selling price above 0 and a photo
-- (a standard Incline photo is offered in the app). Also re-checked when price/photo change on a live product.
CREATE OR REPLACE FUNCTION public.tg_products_sellable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_sellable AND (TG_OP = 'INSERT'
      OR OLD.is_sellable IS DISTINCT FROM true
      OR NEW.price IS DISTINCT FROM OLD.price
      OR NEW.image_url IS DISTINCT FROM OLD.image_url) THEN
    IF coalesce(NEW.price, 0) <= 0 THEN
      RAISE EXCEPTION 'Set a selling price above ₹0 before selling this product on POS';
    END IF;
    IF coalesce(NEW.image_url, '') = '' THEN
      RAISE EXCEPTION 'Add a photo (or use the standard Incline photo) before selling this product on POS';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_products_sellable_guard ON public.products;
CREATE TRIGGER trg_products_sellable_guard BEFORE INSERT OR UPDATE OF is_sellable, price, image_url ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_sellable_guard();

CREATE INDEX IF NOT EXISTS stock_movements_branch_created_idx ON public.stock_movements (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_reference_idx ON public.stock_movements (reference_id) WHERE reference_id IS NOT NULL;

-- Atomic stock adjustment: add / remove / set exact count, always logged in stock_movements.
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id uuid, p_branch_id uuid, p_mode text, p_quantity integer, p_reason text,
  p_notes text DEFAULT NULL, p_batch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prod record; v_inv record; v_batch record;
  v_old integer; v_new integer; v_new_inv integer; v_delta integer := 0;
  v_left integer; v_take integer; v_note text;
BEGIN
  IF public.rpc_guard_applies('adjust_product_stock') THEN
    IF NOT ((SELECT public.has_any_role(v_uid, ARRAY['owner','admin']::app_role[]))
       OR ((SELECT public.has_any_role(v_uid, ARRAY['manager','staff']::app_role[]))
           AND p_branch_id IN (SELECT public.user_visible_branch_ids(v_uid)))) THEN
      RAISE EXCEPTION 'forbidden: you cannot adjust stock for this branch' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('add','remove','set') THEN RAISE EXCEPTION 'Choose add, remove or set exact count'; END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR (p_mode <> 'set' AND p_quantity = 0) THEN RAISE EXCEPTION 'Enter a quantity greater than 0'; END IF;
  IF p_quantity > 100000 THEN RAISE EXCEPTION 'Quantity is too large'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('count','damaged','expired','internal_use','supplier_return','correction','opening','received') THEN
    RAISE EXCEPTION 'Choose a reason for this adjustment';
  END IF;
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN RAISE EXCEPTION 'Choose a branch'; END IF;
  SELECT id, name, coalesce(requires_batch_tracking, false) AS batched INTO v_prod FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;

  v_note := initcap(replace(p_reason, '_', ' ')) || coalesce(' — ' || nullif(btrim(p_notes), ''), '');

  INSERT INTO public.inventory (product_id, branch_id, quantity, min_quantity)
  VALUES (p_product_id, p_branch_id, 0, 5) ON CONFLICT (product_id, branch_id) DO NOTHING;
  SELECT * INTO v_inv FROM public.inventory WHERE product_id = p_product_id AND branch_id = p_branch_id FOR UPDATE;
  v_old := coalesce(v_inv.quantity, 0);

  IF v_prod.batched THEN
    IF p_batch_id IS NOT NULL THEN
      SELECT * INTO v_batch FROM public.product_batches
       WHERE id = p_batch_id AND product_id = p_product_id AND branch_id = p_branch_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found for this product and branch'; END IF;
      v_new := CASE p_mode WHEN 'add' THEN v_batch.quantity_remaining + p_quantity
                           WHEN 'remove' THEN v_batch.quantity_remaining - p_quantity
                           ELSE p_quantity END;
      IF v_new < 0 THEN RAISE EXCEPTION 'Only % unit(s) left in batch %', v_batch.quantity_remaining, v_batch.batch_number; END IF;
      v_delta := v_new - v_batch.quantity_remaining;
      IF v_delta <> 0 THEN
        UPDATE public.product_batches
           SET quantity_remaining = v_new,
               status = CASE WHEN v_new > 0 AND status = 'depleted' THEN 'active' ELSE status END
         WHERE id = p_batch_id;
        INSERT INTO public.stock_movements (product_id, branch_id, batch_id, movement_type, quantity, reference_type, notes, created_by)
        VALUES (p_product_id, p_branch_id, p_batch_id, CASE WHEN v_delta > 0 THEN 'adjust_in' ELSE 'adjust_out' END,
                abs(v_delta), 'stock_adjustment', v_note || ' · Batch ' || v_batch.batch_number, v_uid);
      END IF;
    ELSIF p_mode = 'remove' THEN
      v_left := p_quantity;
      FOR v_batch IN SELECT * FROM public.product_batches
                      WHERE product_id = p_product_id AND branch_id = p_branch_id AND quantity_remaining > 0
                        AND status IN ('active','expired','quarantined')
                      ORDER BY exp_date NULLS LAST, created_at FOR UPDATE LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(v_left, v_batch.quantity_remaining);
        UPDATE public.product_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = v_batch.id;
        INSERT INTO public.stock_movements (product_id, branch_id, batch_id, movement_type, quantity, reference_type, notes, created_by)
        VALUES (p_product_id, p_branch_id, v_batch.id, 'adjust_out', v_take, 'stock_adjustment', v_note || ' · Batch ' || v_batch.batch_number, v_uid);
        v_left := v_left - v_take;
      END LOOP;
      IF v_left > 0 THEN RAISE EXCEPTION 'Only % unit(s) are left across batches', p_quantity - v_left; END IF;
      v_delta := -p_quantity;
    ELSE
      RAISE EXCEPTION 'Choose a batch. New stock for batch-tracked products is received with Add batch.';
    END IF;
    v_new_inv := GREATEST(0, v_old + v_delta);
  ELSE
    v_new_inv := CASE p_mode WHEN 'add' THEN v_old + p_quantity WHEN 'remove' THEN v_old - p_quantity ELSE p_quantity END;
    IF v_new_inv < 0 THEN RAISE EXCEPTION 'Only % in stock', v_old; END IF;
    v_delta := v_new_inv - v_old;
    IF v_delta <> 0 THEN
      INSERT INTO public.stock_movements (product_id, branch_id, movement_type, quantity, reference_type, notes, created_by)
      VALUES (p_product_id, p_branch_id, CASE WHEN v_delta > 0 THEN 'adjust_in' ELSE 'adjust_out' END,
              abs(v_delta), 'stock_adjustment', v_note, v_uid);
    END IF;
  END IF;

  UPDATE public.inventory
     SET quantity = v_new_inv,
         last_restocked_at = CASE WHEN v_delta > 0 THEN now() ELSE last_restocked_at END,
         updated_at = now()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object('success', true, 'old_quantity', v_old, 'new_quantity', v_new_inv, 'delta', v_delta);
END $$;
REVOKE EXECUTE ON FUNCTION public.adjust_product_stock(uuid, uuid, text, integer, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid, uuid, text, integer, text, text, uuid) TO authenticated;

-- Return stock when a POS/member-store sale's invoice is cancelled (idempotent).
CREATE OR REPLACE FUNCTION public.restore_pos_sale_stock(p_pos_sale_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- guard-exempt: called only by the invoice cancellation trigger; EXECUTE revoked from signed-in users.
DECLARE v_m record; v_n integer := 0;
BEGIN
  IF p_pos_sale_id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos_restock:' || p_pos_sale_id::text));
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_id = p_pos_sale_id AND movement_type = 'sale_return') THEN
    RETURN 0;
  END IF;
  FOR v_m IN SELECT * FROM public.stock_movements
              WHERE reference_id = p_pos_sale_id AND reference_type = 'pos_sale' AND movement_type = 'sale' LOOP
    IF v_m.batch_id IS NOT NULL THEN
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining + v_m.quantity,
             status = CASE WHEN status = 'depleted' THEN 'active' ELSE status END
       WHERE id = v_m.batch_id;
    END IF;
    UPDATE public.inventory SET quantity = coalesce(quantity, 0) + v_m.quantity, updated_at = now()
     WHERE product_id = v_m.product_id AND branch_id = v_m.branch_id;
    INSERT INTO public.stock_movements (product_id, branch_id, batch_id, movement_type, quantity, reference_id, reference_type, notes, created_by)
    VALUES (v_m.product_id, v_m.branch_id, v_m.batch_id, 'sale_return', v_m.quantity, p_pos_sale_id, 'pos_sale',
            'Stock returned — sale cancelled', auth.uid());
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.restore_pos_sale_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_pos_sale_stock(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_invoice_restore_pos_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- guard-exempt: trigger function; EXECUTE revoked from signed-in users.
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.pos_sale_id IS NOT NULL THEN
    PERFORM public.restore_pos_sale_stock(NEW.pos_sale_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_invoice_restore_pos_stock() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invoice_restore_pos_stock ON public.invoices;
CREATE TRIGGER trg_invoice_restore_pos_stock AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_restore_pos_stock();

-- Every received batch (manual or purchase-bill import) is logged as stock in.
CREATE OR REPLACE FUNCTION public.tg_product_batch_stock_in() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- guard-exempt: trigger function; EXECUTE revoked from signed-in users.
BEGIN
  IF coalesce(NEW.quantity_received, 0) > 0 THEN
    INSERT INTO public.stock_movements (product_id, branch_id, batch_id, movement_type, quantity, reference_id, reference_type, notes, created_by)
    VALUES (NEW.product_id, NEW.branch_id, NEW.id, 'stock_in', NEW.quantity_received, NEW.id, 'batch',
            'Batch ' || NEW.batch_number || coalesce(' · ' || nullif(NEW.supplier, ''), ''), coalesce(NEW.created_by, auth.uid()));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_product_batch_stock_in() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_product_batch_stock_in ON public.product_batches;
CREATE TRIGGER trg_product_batch_stock_in AFTER INSERT ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.tg_product_batch_stock_in();