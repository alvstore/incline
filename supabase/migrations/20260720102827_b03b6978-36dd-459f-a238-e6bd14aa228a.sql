-- Fix invalid enum literal 'accountant' in member invoice guard triggers.
-- app_role enum has: owner, admin, manager, trainer, staff, member.
-- The IN (...) list was implicitly cast to app_role[] and failed with
-- "invalid input value for enum app_role: accountant" during
-- purchase_member_membership → INSERT invoices.
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
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role IN ('owner','admin','manager','staff','trainer')
  ) INTO is_staff;
  IF is_staff THEN
    RETURN NEW;
  END IF;

  IF NEW.member_id IS NULL OR NEW.member_id <> public.get_member_id(uid) THEN
    RAISE EXCEPTION 'members can only create invoices for themselves';
  END IF;

  NEW.status := 'pending';
  NEW.amount_paid := 0;
  NEW.discount_amount := COALESCE(NEW.discount_amount, 0);
  IF NEW.discount_amount < 0 THEN NEW.discount_amount := 0; END IF;
  NEW.paid_at := NULL;
  NEW.payment_method := NULL;
  NEW.payment_reference := NULL;
  NEW.invoice_number := NULL;

  RETURN NEW;
END;
$$;

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
      AND role IN ('owner','admin','manager','staff','trainer')
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