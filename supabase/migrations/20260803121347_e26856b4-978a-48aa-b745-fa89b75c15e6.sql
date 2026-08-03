CREATE OR REPLACE FUNCTION public.tasks_notify_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    BEGIN
      INSERT INTO public.notifications(user_id, title, message, type, action_url, branch_id)
      VALUES (
        NEW.assigned_to,
        'New task assigned',
        COALESCE(NEW.title, 'You have been assigned a task'),
        'task',
        '/tasks?id=' || NEW.id,
        NEW.branch_id
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- never block a task assignment because of a notification failure
    END;
  END IF;
  RETURN NEW;
END;
$$;