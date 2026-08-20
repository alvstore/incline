-- Instant access revocation trigger for overdue invoices and membership status changes
-- v1.0.0

-- Ensure the trigger function exists and handles updates to invoices and payments
CREATE OR REPLACE FUNCTION public.tg_auto_evaluate_member_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_actor_id uuid;
  v_notes text;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    -- Trigger on status change to 'overdue' or 'unpaid'
    IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) OR TG_OP = 'INSERT' THEN
      v_member_id := NEW.member_id;
      v_actor_id := auth.uid();
      v_notes := 'Invoice ' || NEW.invoice_number || ' status changed to ' || NEW.status;
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_member_id := NEW.member_id;
    v_actor_id := auth.uid();
    v_notes := 'Payment recorded for member';
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) OR TG_OP = 'INSERT' THEN
      v_member_id := NEW.member_id;
      v_actor_id := auth.uid();
      v_notes := 'Membership status changed to ' || NEW.status;
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_member_id IS NOT NULL THEN
    -- Evaluate state locally (updates members.hardware_access_status)
    -- This inserts into hardware_access_events which fires trg_sync_hardware_access_to_mips
    PERFORM public.evaluate_member_access_state(v_member_id, v_actor_id, v_notes, false);
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing if any to ensure clean state
DROP TRIGGER IF EXISTS trg_auto_evaluate_access_on_invoice ON public.invoices;
DROP TRIGGER IF EXISTS trg_auto_evaluate_access_on_payment ON public.payments;
DROP TRIGGER IF EXISTS trg_auto_evaluate_access_on_membership ON public.memberships;

-- Re-create triggers to ensure they are active
CREATE TRIGGER trg_auto_evaluate_access_on_invoice
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_evaluate_member_access();

CREATE TRIGGER trg_auto_evaluate_access_on_payment
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_evaluate_member_access();

CREATE TRIGGER trg_auto_evaluate_access_on_membership
  AFTER INSERT OR UPDATE OF status ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_evaluate_member_access();

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.tg_auto_evaluate_member_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_auto_evaluate_member_access() TO service_role;
