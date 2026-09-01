CREATE OR REPLACE FUNCTION public.notification_recipients(p_branch_id uuid, p_category text DEFAULT NULL)
RETURNS TABLE(u_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT r.u_id
  FROM (
    SELECT ur.user_id AS u_id FROM public.user_roles ur WHERE ur.role IN ('owner','admin')
    UNION
    SELECT bm.user_id FROM public.branch_managers bm WHERE bm.branch_id = p_branch_id
    UNION
    SELECT sb.user_id FROM public.staff_branches sb WHERE sb.branch_id = p_branch_id
  ) r
  WHERE r.u_id IS NOT NULL
    -- pure trainers only get coaching-relevant categories
    AND (
      COALESCE(p_category,'') IN ('class','announcement','task','task_assigned','task_overdue','pt_payment')
      OR NOT public.is_pure_trainer(r.u_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.notify_payment_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT DISTINCT tr.user_id, NEW.branch_id,
      'Client payment received',
      'Payment of ₹' || NEW.amount || ' received from your PT client ' || COALESCE(member_name, 'a member'),
      'success', 'pt_payment',
      jsonb_build_object('payment_id', NEW.id, 'member_id', NEW.member_id)
    FROM public.member_pt_packages mpp
    JOIN public.trainers tr ON tr.id = mpp.trainer_id
    WHERE mpp.member_id = NEW.member_id
      AND mpp.status IN ('active','pending_payment')
      AND tr.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_roles ur2
        WHERE ur2.user_id = tr.user_id AND ur2.role IN ('owner','admin')
      );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;