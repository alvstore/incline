-- Hardened member access triggers to ensure immediate biometric revocation when dues are overdue.
-- v1.1.0 - Includes search_path hardening and explicit mips-access edge function call.

CREATE OR REPLACE FUNCTION public.tg_auto_evaluate_member_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_member_id uuid;
  v_actor_id uuid;
  v_notes text;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    v_member_id := NEW.member_id;
    v_actor_id := auth.uid();
    v_notes := 'Invoice ' || NEW.invoice_number || ' status changed to ' || NEW.status;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_member_id := NEW.member_id;
    v_actor_id := auth.uid();
    v_notes := 'Payment recorded for member';
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    v_member_id := NEW.member_id;
    v_actor_id := auth.uid();
    v_notes := 'Membership status changed to ' || NEW.status;
  ELSE
    RETURN NEW;
  END IF;

  IF v_member_id IS NOT NULL THEN
    -- Evaluate state locally first (updates members.hardware_access_status)
    PERFORM public.evaluate_member_access_state(v_member_id, v_actor_id, v_notes, false);
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on invoices (status or due_date changes)
DROP TRIGGER IF EXISTS trg_auto_evaluate_access_on_invoice ON public.invoices;
CREATE TRIGGER trg_auto_evaluate_access_on_invoice
AFTER UPDATE OF status, due_date ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.tg_auto_evaluate_member_access();

-- Trigger on payments (new payment affects dues)
DROP TRIGGER IF EXISTS trg_auto_evaluate_access_on_payment ON public.payments;
CREATE TRIGGER trg_auto_evaluate_access_on_payment
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_auto_evaluate_member_access();

-- Trigger on memberships (status changes)
DROP TRIGGER IF EXISTS trg_auto_evaluate_access_on_membership ON public.memberships;
CREATE TRIGGER trg_auto_evaluate_access_on_membership
AFTER UPDATE OF status ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.tg_auto_evaluate_member_access();


-- Now, handle the actual hardware PUSH when the access event indicates sync is required.
-- We use hardware_access_events as the reliable ledger to drive the edge function call.

CREATE OR REPLACE FUNCTION public.tg_sync_hardware_access_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_action text;
BEGIN
  -- We only push if the record says it requires sync
  IF NOT NEW.requires_sync THEN
    RETURN NEW;
  END IF;

  -- Resolve credentials (same pattern as tg_push_photo_to_mips)
  v_supabase_url := 'https://iyqqpbvnszyrrgerniog.supabase.co';
  v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';

  v_action := CASE 
    WHEN NEW.new_status IN ('blocked_overdue', 'blocked_member_status', 'frozen', 'expired', 'revoked') THEN 'revoke'
    WHEN NEW.new_status = 'active' THEN 'restore'
    ELSE NULL
  END;

  IF v_action IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/mips-access',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', v_anon_key,
          'Authorization', 'Bearer ' || v_anon_key,
          'x-lovable-system', 'access-event-sync'
        ),
        body := jsonb_build_object(
          'action', v_action,
          'member_id', NEW.member_id,
          'branch_id', NEW.branch_id,
          'reason', NEW.reason
        ),
        timeout_ms := 5000
      );
      
      -- Mark as sync attempted (non-blocking if it fails, the cron sweep will catch it later)
      UPDATE public.hardware_access_events SET requires_sync = false WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'MIPS access sync HTTP call failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_hardware_access_to_mips ON public.hardware_access_events;
CREATE TRIGGER trg_sync_hardware_access_to_mips
AFTER INSERT ON public.hardware_access_events
FOR EACH ROW
EXECUTE FUNCTION public.tg_sync_hardware_access_to_mips();
