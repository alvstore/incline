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
  v_branch_id uuid;
BEGIN
  -- Normalize notification type
  v_category := p_type;
  v_type := CASE 
    WHEN p_type IN ('info','success','warning','error','reminder','task') THEN p_type 
    ELSE 'info' 
  END;

  -- Build action URL for task links
  IF p_linked_entity_id IS NOT NULL AND p_type = 'task' THEN
    v_action_url := '/tasks?id=' || p_linked_entity_id;
  END IF;

  -- Attempt to inherit branch_id from the linked task if possible
  IF p_type = 'task' AND p_linked_entity_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch_id FROM public.tasks WHERE id::text = p_linked_entity_id LIMIT 1;
  END IF;

  INSERT INTO public.notifications (
    user_id, 
    branch_id,
    title, 
    message, 
    type, 
    category, 
    action_url, 
    metadata
  )
  VALUES (
    p_user_id,
    v_branch_id,
    p_title,
    p_message,
    v_type,
    v_category,
    v_action_url,
    jsonb_build_object(
      'linked_entity_id', p_linked_entity_id, 
      'linked_entity_type', p_type,
      'created_via', 'create_system_notification_v2'
    )
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_system_notification(uuid, text, text, text, text) TO authenticated, service_role;

-- Harden the task trigger to be more resilient and handle staff name resolution safely
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
  v_actor_id uuid;
BEGIN
  v_branch_id := NEW.branch_id;
  v_task_title := NEW.title;
  v_actor_id := auth.uid();

  BEGIN
    -- Only notify if it's a new task or assignment changed
    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
      
      IF NEW.assigned_to IS NOT NULL THEN
        SELECT full_name INTO v_assigned_to_name FROM public.profiles WHERE id = NEW.assigned_to;
        
        -- Notify the assignee specifically
        PERFORM public.create_system_notification(
          NEW.assigned_to,
          'Task Assigned: ' || v_task_title,
          'You have been assigned a new task: ' || v_task_title || '.',
          'task',
          NEW.id::text
        );
      END IF;

      -- Notify management (Owners, Admins, and Branch Managers)
      -- Exclude the person who actually created the task to avoid self-notification noise
      PERFORM public.create_system_notification(
        ur.user_id,
        'Task Update: ' || v_task_title,
        CASE 
          WHEN TG_OP = 'INSERT' THEN 'A new task has been created' 
          ELSE 'Task assignment has been updated' 
        END || CASE WHEN v_assigned_to_name IS NOT NULL THEN ' and assigned to ' || v_assigned_to_name ELSE '' END || '.',
        'task',
        NEW.id::text
      )
      FROM public.user_roles ur
      WHERE ur.user_id != v_actor_id
        AND (
          ur.role IN ('owner', 'admin')
          OR (ur.role = 'manager' AND EXISTS (
                SELECT 1 FROM public.branch_managers bm
                WHERE bm.user_id = ur.user_id AND bm.branch_id = v_branch_id
              ))
        );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Prevent notification failures from rolling back the actual task save
    RAISE WARNING 'tasks_notify_management failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;