-- 1. Repair task assignee notifications.
-- The old version used type='task', which violates notifications_type_check
-- ('info','success','warning','error','reminder'). The insert failed and was
-- swallowed by the EXCEPTION handler, so assignees never saw anything.
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
      INSERT INTO public.notifications(user_id, title, message, type, category, action_url, branch_id, metadata)
      VALUES (
        NEW.assigned_to,
        'New task assigned',
        COALESCE(NEW.title, 'You have been assigned a task'),
        'info',
        'task_assigned',
        '/tasks?id=' || NEW.id,
        NEW.branch_id,
        jsonb_build_object(
          'task_id', NEW.id,
          'priority', NEW.priority,
          'due_date', NEW.due_date,
          'linked_entity_type', NEW.linked_entity_type,
          'linked_entity_id', NEW.linked_entity_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- never block a task assignment because of a notification failure
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Seed the staff-facing "task assigned" email template (one per branch).
INSERT INTO public.templates (branch_id, name, type, subject, content, variables, trigger_event, is_active)
SELECT
  b.id,
  'Task Assigned — Staff Alert',
  'email',
  'New task assigned: {{task_title}}',
  E'Hi {{assignee_name}},\n\nA new task has been assigned to you.\n\nTask: {{task_title}}\nPriority: {{priority}}\nDue: {{due_date}}\n\nOpen it here: {{link}}\n\nPlease action it as soon as possible.',
  '["assignee_name","task_title","priority","due_date","link"]'::jsonb,
  'task_assigned',
  true
FROM public.branches b
WHERE NOT EXISTS (
  SELECT 1 FROM public.templates t
  WHERE t.trigger_event = 'task_assigned'
    AND t.type = 'email'
    AND t.branch_id = b.id
);

-- 3. Nudge absent members sooner: stage 1 at 3 days, stage 2 at 7, stage 3 at 14.
UPDATE public.retention_templates SET days_trigger = 3  WHERE stage_level = 1 AND days_trigger <> 3;
UPDATE public.retention_templates SET days_trigger = 7  WHERE stage_level = 2 AND days_trigger <> 7;
UPDATE public.retention_templates SET days_trigger = 14 WHERE stage_level = 3 AND days_trigger <> 14;