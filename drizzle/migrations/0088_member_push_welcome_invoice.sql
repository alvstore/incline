CREATE OR REPLACE FUNCTION public.notify_member_event(p_user_id uuid, p_branch_id uuid, p_title text, p_message text, p_category text, p_url text, p_event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = p_user_id AND metadata->>'event' = p_event) THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, branch_id, title, message, type, category, action_url, metadata)
  VALUES (p_user_id, p_branch_id, p_title, p_message, 'info', p_category, p_url, jsonb_build_object('event', p_event));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_member_event(uuid,uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_member_event(uuid,uuid,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_member_welcome_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.user_id IS NULL) THEN
    PERFORM public.notify_member_event(NEW.user_id, NEW.branch_id, 'Welcome to Incline',
      'Your membership account is ready. Explore your plan, classes and bookings.', 'member', '/member-dashboard',
      'welcome:' || NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_member_welcome_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_member_welcome_notification ON public.members;
CREATE TRIGGER trg_member_welcome_notification AFTER INSERT OR UPDATE OF user_id ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_welcome_notification();

CREATE OR REPLACE FUNCTION public.tg_notify_member_on_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_old text;
BEGIN
  IF NEW.member_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id INTO v_user_id FROM public.members WHERE id = NEW.member_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;
  v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END;
  IF NEW.status::text IN ('pending','partial','paid','overdue') AND (v_old IS NULL OR v_old = 'draft') THEN
    PERFORM public.notify_member_event(v_user_id, NEW.branch_id, 'New invoice generated',
      'Invoice ' || COALESCE(NEW.invoice_number,'') || ' for ₹' || COALESCE(NEW.total_amount,0)::text,
      'billing', '/my-invoices', 'invoice_issued:' || NEW.id);
  END IF;
  IF NEW.status::text IN ('partial','paid') AND v_old IS DISTINCT FROM NEW.status::text AND v_old IS NOT NULL THEN
    PERFORM public.notify_member_event(v_user_id, NEW.branch_id, 'Payment received',
      'Payment received for invoice ' || COALESCE(NEW.invoice_number,'') ||
      CASE WHEN NEW.status::text = 'paid' THEN ' — fully paid.' ELSE ' — partially paid.' END,
      'billing', '/my-invoices', 'invoice_' || NEW.status::text || ':' || NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_notify_member_on_invoice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_member_on_invoice_insert ON public.invoices;
CREATE TRIGGER notify_member_on_invoice_insert AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_member_on_invoice();