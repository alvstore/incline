-- 1. Helper: is this user a pure trainer (no admin-side role)?
CREATE OR REPLACE FUNCTION public.is_pure_trainer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles t WHERE t.user_id = _user_id AND t.role = 'trainer')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles a
       WHERE a.user_id = _user_id AND a.role IN ('owner','admin','manager','staff')
     );
$$;

-- 2. Locker alerts: route through the central recipient helper (excludes pure trainers)
CREATE OR REPLACE FUNCTION public.notify_locker_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  member_name TEXT;
  locker_num TEXT;
  v_branch_id UUID;
BEGIN
  SELECT p.full_name, m.branch_id INTO member_name, v_branch_id
  FROM members m JOIN profiles p ON p.id = m.user_id
  WHERE m.id = NEW.member_id;

  SELECT locker_number INTO locker_num FROM lockers WHERE id = NEW.locker_id;

  INSERT INTO notifications (user_id, branch_id, title, message, type, category)
  SELECT r.user_id, v_branch_id,
    'Locker Assigned',
    'Locker #' || COALESCE(locker_num, '?') || ' assigned to ' || COALESCE(member_name, 'a member'),
    'info', 'locker'
  FROM public.notification_recipients(v_branch_id, 'locker') r;
  RETURN NEW;
END;
$function$;

-- 3. Payments: keep management alerts, and add a trainer alert for their own PT client
CREATE OR REPLACE FUNCTION public.notify_payment_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  member_name TEXT;
BEGIN
  SELECT p.full_name INTO member_name
  FROM members m JOIN profiles p ON p.id = m.user_id
  WHERE m.id = NEW.member_id;

  INSERT INTO notifications (user_id, branch_id, title, message, type, category)
  SELECT DISTINCT u_id, NEW.branch_id,
    'Payment Received',
    'Payment of ₹' || NEW.amount || ' received from ' || COALESCE(member_name, 'a member'),
    'success', 'payment'
  FROM (
    SELECT ur.user_id AS u_id FROM user_roles ur WHERE ur.role IN ('owner', 'admin')
    UNION
    SELECT bm.user_id FROM branch_managers bm WHERE bm.branch_id = NEW.branch_id
  ) recipients
  WHERE u_id IS NOT NULL;

  -- Trainer of this member's PT package(s) gets their own client-scoped alert
  BEGIN
    INSERT INTO notifications (user_id, branch_id, title, message, type, category, metadata)
    SELECT DISTINCT tp.user_id, NEW.branch_id,
      'Client payment received',
      'Payment of ₹' || NEW.amount || ' received from your PT client ' || COALESCE(member_name, 'a member'),
      'success', 'pt_payment',
      jsonb_build_object('payment_id', NEW.id, 'member_id', NEW.member_id)
    FROM public.member_pt_packages mpp
    JOIN public.trainers tr ON tr.id = mpp.trainer_id
    JOIN public.profiles tp ON tp.id = tr.user_id
    WHERE mpp.member_id = NEW.member_id
      AND mpp.status IN ('active','pending_payment')
      AND tp.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_roles ur2
        WHERE ur2.user_id = tp.user_id AND ur2.role IN ('owner','admin')
      );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$function$;

-- 4. Purge management-only alerts that leaked to pure trainers before the fix
DELETE FROM public.notifications n
WHERE public.is_pure_trainer(n.user_id)
  AND n.category IN ('retention','member','lead','locker','payment','staff_late','membership','task_broadcast','whatsapp');