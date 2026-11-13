CREATE OR REPLACE FUNCTION public.tg_reactivate_membership_on_payment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'completed'::public.payment_status THEN RETURN NEW; END IF;
  IF NEW.lifecycle_status = 'voided'::public.payment_transaction_status THEN RETURN NEW; END IF;
  IF COALESCE(NEW.amount, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND OR v_invoice.status = 'cancelled'::public.invoice_status THEN RETURN NEW; END IF;

  UPDATE public.memberships m
     SET status = 'active'::public.membership_status, updated_at = now()
   WHERE m.status = 'pending'::public.membership_status
     AND m.start_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND m.id IN (
       SELECT ii.reference_id FROM public.invoice_items ii
        WHERE ii.invoice_id = NEW.invoice_id
          AND ii.reference_type = 'membership'
          AND ii.reference_id IS NOT NULL);
  RETURN NEW;
END;
$function$;