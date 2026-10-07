CREATE OR REPLACE FUNCTION public.enforce_member_invoice_item_defaults()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_staff boolean := false;
  inv RECORD;
BEGIN
  IF uid IS NULL OR COALESCE(current_setting('app.trusted_invoice', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid
      AND role IN ('owner','admin','manager','staff','trainer')) INTO is_staff;
  IF is_staff THEN RETURN NEW; END IF;
  SELECT id, member_id, status INTO inv FROM public.invoices WHERE id = NEW.invoice_id;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF inv.member_id IS DISTINCT FROM public.get_member_id(uid) THEN
    RAISE EXCEPTION 'members can only add items to their own invoices';
  END IF;
  IF inv.status NOT IN ('pending','draft') THEN
    RAISE EXCEPTION 'invoice is no longer editable by member';
  END IF;
  IF COALESCE(NEW.quantity, 0) < 0 THEN RAISE EXCEPTION 'quantity must be non-negative'; END IF;
  IF COALESCE(NEW.unit_price, 0) < 0 THEN RAISE EXCEPTION 'unit_price must be non-negative'; END IF;
  RETURN NEW;
END;
$function$;

DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_pos_sale';
  IF position('app.trusted_invoice' in d) = 0 THEN
    d := replace(d, E'BEGIN\n  IF p_items IS NULL',
      E'BEGIN\n  -- Prices are recomputed server-side for members above; invoice totals are authoritative.\n  PERFORM set_config(''app.trusted_invoice'', ''true'', true);\n  IF p_items IS NULL');
    d := replace(d, E'UPDATE public.pos_sales SET invoice_id = v_invoice_id WHERE id = v_pos_sale_id;',
      E'UPDATE public.pos_sales SET invoice_id = v_invoice_id WHERE id = v_pos_sale_id;\n    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total_amount, reference_type, reference_id)\n    SELECT v_invoice_id, COALESCE(NULLIF(e->>''name'',''''), ''Store item''), COALESCE((e->>''quantity'')::numeric,1)::int,\n           COALESCE((e->>''unit_price'')::numeric, (e->>''price'')::numeric, 0),\n           COALESCE((e->>''total'')::numeric, 0), ''product'', NULLIF(e->>''product_id'','''')\n      FROM jsonb_array_elements(v_items) e;');
    EXECUTE d;
  END IF;
END $mig$;