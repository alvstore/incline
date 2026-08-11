CREATE OR REPLACE FUNCTION public.tasks_notify_management()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
BEGIN
  IF (TG_OP = 'INSERT') OR
     (NEW.member_created IS TRUE AND OLD.member_created IS FALSE) OR
     (NEW.priority = 'urgent' AND OLD.priority != 'urgent')
  THEN
    INSERT INTO public.notifications (
      branch_id, user_id, title, message, type, category, is_read, action_url, metadata
    )
    SELECT
      NEW.branch_id,
      p.id,
      CASE WHEN NEW.member_created THEN '🚨 Member Request' ELSE '🔥 Urgent Task' END,
      NEW.title,
      'reminder',
      'task_reminder',
      false,
      '/tasks?id=' || NEW.id,
      jsonb_build_object(
        'task_id', NEW.id,
        'broad_alert', true,
        'reason', CASE WHEN NEW.member_created THEN 'member_request' ELSE 'urgent_priority' END
      )
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE ur.role IN ('owner', 'admin')
       OR (ur.role = 'manager' AND NEW.branch_id IN (
         SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = p.id
       ));
  END IF;

  RETURN NEW;
END;
$$;