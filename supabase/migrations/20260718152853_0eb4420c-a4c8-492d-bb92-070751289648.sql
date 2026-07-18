
-- Trigger: on member-initiated invoice inserts, force safe defaults.
-- "Member-initiated" = auth.uid() maps to a member AND caller is NOT staff/admin.
CREATE OR REPLACE FUNCTION public.enforce_member_invoice_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_staff boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN NEW; -- service_role / internal calls
  END IF;

  -- If caller has any staff-side role, do not clamp.
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role IN ('owner','admin','manager','staff','accountant','trainer')
  ) INTO is_staff;
  IF is_staff THEN
    RETURN NEW;
  END IF;

  -- From here: authenticated end user acting as a member.
  IF NEW.member_id IS NULL OR NEW.member_id <> public.get_member_id(uid) THEN
    RAISE EXCEPTION 'members can only create invoices for themselves';
  END IF;

  -- Force safe billing defaults so members cannot self-mark as paid.
  NEW.status := 'pending';
  NEW.amount_paid := 0;
  NEW.discount_amount := COALESCE(NEW.discount_amount, 0);
  IF NEW.discount_amount < 0 THEN NEW.discount_amount := 0; END IF;
  NEW.paid_at := NULL;
  NEW.payment_method := NULL;
  NEW.payment_reference := NULL;

  -- Do not let members pick their own invoice_number (unique/audited trigger owns it).
  NEW.invoice_number := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_member_invoice_defaults ON public.invoices;
CREATE TRIGGER trg_enforce_member_invoice_defaults
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_invoice_defaults();

-- Trigger on invoice_items: prevent members from inserting lines on invoices
-- that aren't in a member-editable state (pending), and clamp negative amounts.
CREATE OR REPLACE FUNCTION public.enforce_member_invoice_item_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_staff boolean := false;
  inv RECORD;
BEGIN
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role IN ('owner','admin','manager','staff','accountant','trainer')
  ) INTO is_staff;
  IF is_staff THEN
    RETURN NEW;
  END IF;

  SELECT id, member_id, status INTO inv FROM public.invoices WHERE id = NEW.invoice_id;
  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;
  IF inv.member_id IS DISTINCT FROM public.get_member_id(uid) THEN
    RAISE EXCEPTION 'members can only add items to their own invoices';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invoice is no longer editable by member';
  END IF;

  IF COALESCE(NEW.quantity, 0) < 0 THEN
    RAISE EXCEPTION 'quantity must be non-negative';
  END IF;
  IF COALESCE(NEW.unit_price, 0) < 0 THEN
    RAISE EXCEPTION 'unit_price must be non-negative';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_member_invoice_item_defaults ON public.invoice_items;
CREATE TRIGGER trg_enforce_member_invoice_item_defaults
BEFORE INSERT ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_invoice_item_defaults();
