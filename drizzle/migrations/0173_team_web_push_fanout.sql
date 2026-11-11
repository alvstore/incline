CREATE OR REPLACE FUNCTION public.enqueue_web_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
DECLARE v_team boolean;
BEGIN
  -- Owners/admins get every branch; managers get branches they manage.
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.user_id AND (ur.role IN ('owner','admin')
    OR (ur.role = 'manager' AND (NEW.branch_id IS NULL OR NEW.branch_id IN (SELECT public.managed_branch_ids(NEW.user_id))))))
  INTO v_team;
  INSERT INTO public.web_push_deliveries(notification_id, subscription_id)
  SELECT NEW.id, s.id FROM public.web_push_subscriptions s
  WHERE s.user_id = NEW.user_id AND (v_team OR NEW.branch_id IS NULL OR s.branch_id = NEW.branch_id)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN PERFORM private.run_web_push(); END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Browser push enqueue failed'; RETURN NEW;
END $function$;