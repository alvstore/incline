CREATE OR REPLACE FUNCTION public.tg_invoice_activate_pt_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pkg record;
BEGIN
  -- Only act when the invoice is (now) fully settled.
  IF COALESCE(NEW.amount_paid, 0) < COALESCE(NEW.total_amount, 0)
     OR COALESCE(NEW.total_amount, 0) <= 0
     OR NEW.status IN ('cancelled', 'refunded') THEN
    RETURN NEW;
  END IF;

  FOR _pkg IN
    SELECT id FROM public.member_pt_packages
    WHERE invoice_id = NEW.id AND status = 'pending_payment'
  LOOP
    PERFORM public.activate_pt_package(_pkg.id, NULL);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_activate_pt_package ON public.invoices;
CREATE TRIGGER trg_invoice_activate_pt_package
AFTER UPDATE OF status, amount_paid ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.tg_invoice_activate_pt_package();