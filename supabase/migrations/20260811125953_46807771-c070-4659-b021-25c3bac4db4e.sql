-- Migration: Broad Task Notifications for Management
-- v1.0.0: Implements broad alerting for member requests or urgent tasks

-- Add management notification toggles to preferences
-- Note: Using the correct table name 'notification_preferences'
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS whatsapp_task_notifications BOOLEAN DEFAULT true;

-- Update the notification function to include broad alerting logic
CREATE OR REPLACE FUNCTION public.tasks_notify_management()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_title text;
  v_priority text;
  v_is_member_request boolean;
BEGIN
  -- We only care about NEW tasks or tasks that just became URGENT/Member Request
  IF (TG_OP = 'INSERT') OR 
     (NEW.member_created IS TRUE AND OLD.member_created IS FALSE) OR
     (NEW.priority = 'urgent' AND OLD.priority != 'urgent') 
  THEN
    -- Broad alert via in-app notification records for dashboard visibility
    INSERT INTO public.notifications (
      branch_id,
      user_id,
      title,
      message,
      type,
      category,
      is_read,
      action_url,
      metadata
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
         SELECT branch_id FROM public.staff_branches WHERE staff_id = p.id
       ));
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_notify_broad_staff ON public.tasks;
CREATE TRIGGER trg_tasks_notify_broad_staff
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.tasks_notify_management();

GRANT SELECT, UPDATE ON public.notification_preferences TO authenticated;
GRANT SELECT, INSERT ON public.notifications TO authenticated;
