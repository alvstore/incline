CREATE OR REPLACE FUNCTION public.notify_lead_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Skip generic notification for WhatsApp AI leads — the whatsapp-webhook
  -- writes its own "🟢 WA" notification with richer context.
  IF NEW.source = 'whatsapp_ai' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, branch_id, title, message, type, category)
  SELECT DISTINCT u_id, NEW.branch_id,
    'New Lead Captured',
    'New lead: ' || COALESCE(NEW.full_name, 'Unknown') || ' (' || COALESCE(NEW.source, 'Direct') || ')',
    'info', 'lead'
  FROM (
    SELECT ur.user_id AS u_id FROM user_roles ur WHERE ur.role IN ('owner', 'admin')
    UNION
    SELECT bm.user_id FROM branch_managers bm WHERE bm.branch_id = NEW.branch_id
    UNION
    SELECT sb.user_id FROM staff_branches sb WHERE sb.branch_id = NEW.branch_id
  ) recipients
  WHERE u_id IS NOT NULL;
  RETURN NEW;
END;
$$;