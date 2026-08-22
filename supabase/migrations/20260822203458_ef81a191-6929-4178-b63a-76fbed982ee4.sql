-- Recipient resolver: admins/owners/branch managers + non-trainer branch staff
CREATE OR REPLACE FUNCTION public.notification_recipients(p_branch_id uuid, p_category text DEFAULT 'general')
RETURNS TABLE(user_id uuid)
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
    -- exclude pure trainers: they only get their own coaching notifications
    AND NOT (
      EXISTS (SELECT 1 FROM public.user_roles t WHERE t.user_id = r.u_id AND t.role = 'trainer')
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles a
        WHERE a.user_id = r.u_id AND a.role IN ('owner','admin','manager','staff')
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.notification_recipients(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_lead_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'whatsapp_ai' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, branch_id, title, message, type, category)
  SELECT r.user_id, NEW.branch_id,
    'New Lead Captured',
    'New lead: ' || COALESCE(NEW.full_name, 'Unknown') || ' (' || COALESCE(NEW.source, 'Direct') || ')',
    'info', 'lead'
  FROM public.notification_recipients(NEW.branch_id, 'lead') r;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_new_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_name TEXT;
BEGIN
  SELECT p.full_name INTO member_name FROM profiles p WHERE p.id = NEW.user_id;

  INSERT INTO notifications (user_id, branch_id, title, message, type, category)
  SELECT r.user_id, NEW.branch_id,
    'New Member Registered',
    'New member registration: ' || COALESCE(member_name, 'Unknown'),
    'info', 'member'
  FROM public.notification_recipients(NEW.branch_id, 'member') r
  WHERE r.user_id <> COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid);
  RETURN NEW;
END;
$$;