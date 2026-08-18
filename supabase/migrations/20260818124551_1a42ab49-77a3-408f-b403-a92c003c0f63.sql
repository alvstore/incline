DROP FUNCTION IF EXISTS public.create_system_notification(uuid,text,text,text,text);

CREATE OR REPLACE FUNCTION public.create_system_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'info',
  p_linked_entity_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id uuid;
  v_type text;
  v_category text;
  v_action_url text;
BEGIN
  v_category := p_type;
  v_type := CASE WHEN p_type IN ('info','success','warning','error','reminder') THEN p_type ELSE 'info' END;

  IF p_linked_entity_id IS NOT NULL AND p_type = 'task' THEN
    v_action_url := '/tasks?id=' || p_linked_entity_id;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, category, action_url, metadata)
  VALUES (
    p_user_id,
    p_title,
    p_message,
    v_type,
    v_category,
    v_action_url,
    jsonb_build_object('linked_entity_id', p_linked_entity_id, 'linked_entity_type', p_type)
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tasks_notify_management()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_task_title text;
  v_assigned_to_name text;
BEGIN
  v_branch_id := NEW.branch_id;
  v_task_title := NEW.title;

  BEGIN
    IF NEW.assigned_to IS NOT NULL THEN
      SELECT full_name INTO v_assigned_to_name FROM public.profiles WHERE id = NEW.assigned_to;
    END IF;

    PERFORM public.create_system_notification(
      ur.user_id,
      'New Task Created: ' || v_task_title,
      'A new task has been created' || CASE WHEN v_assigned_to_name IS NOT NULL THEN ' and assigned to ' || v_assigned_to_name ELSE '' END || '.',
      'task',
      NEW.id::text
    )
    FROM public.user_roles ur
    WHERE ur.role IN ('owner', 'admin')
       OR (ur.role = 'manager' AND EXISTS (
             SELECT 1 FROM public.branch_managers bm
             WHERE bm.user_id = ur.user_id AND bm.branch_id = v_branch_id
           ));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;