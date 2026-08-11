
-- 1. Extend tasks table for SLA and Time-sensitive tracking
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS due_time time,
ADD COLUMN IF NOT EXISTS sla_hours int DEFAULT 24,
ADD COLUMN IF NOT EXISTS started_at timestamptz,
ADD COLUMN IF NOT EXISTS member_created boolean DEFAULT false;

-- 2. Update grants for new columns
GRANT SELECT, INSERT, UPDATE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

-- 3. Enhanced notification function to route to managers/admins for member-created tasks
CREATE OR REPLACE FUNCTION public.tasks_notify_broad_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_manager_id uuid;
  v_admin_ids uuid[];
  v_admin_id uuid;
BEGIN
  -- Notify the specific assignee (standard flow)
  IF NEW.assigned_to IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    BEGIN
      INSERT INTO public.notifications(user_id, title, message, type, category, action_url, branch_id, metadata)
      VALUES (
        NEW.assigned_to, 
        'Task Assigned', 
        NEW.title, 
        'info', 
        'task_assigned', 
        '/tasks?id=' || NEW.id, 
        NEW.branch_id, 
        jsonb_build_object('task_id', NEW.id)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- If member-created or high priority unassigned, alert the chain of command
  IF NEW.member_created OR (NEW.priority IN ('high', 'urgent') AND NEW.assigned_to IS NULL) THEN
    -- Get Branch Manager (simplified logic for staff_branches)
    SELECT user_id INTO v_branch_manager_id 
    FROM public.user_roles ur
    WHERE role = 'manager' 
      AND EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.user_id = ur.user_id AND sb.branch_id = NEW.branch_id)
    LIMIT 1;

    IF v_branch_manager_id IS NOT NULL AND v_branch_manager_id != COALESCE(NEW.assigned_to, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      BEGIN
        INSERT INTO public.notifications(user_id, title, message, type, category, action_url, branch_id, metadata)
        VALUES (
          v_branch_manager_id, 
          'Urgent/Member Task', 
          'New task requires attention: ' || NEW.title, 
          'warning', 
          'task_alert', 
          '/tasks?id=' || NEW.id, 
          NEW.branch_id, 
          jsonb_build_object('task_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    -- Get Admins/Owners
    SELECT array_agg(user_id) INTO v_admin_ids 
    FROM public.user_roles 
    WHERE role IN ('admin', 'owner');

    IF v_admin_ids IS NOT NULL THEN
      FOREACH v_admin_id IN ARRAY v_admin_ids LOOP
        IF v_admin_id != COALESCE(NEW.assigned_to, '00000000-0000-0000-0000-000000000000'::uuid) 
           AND v_admin_id != COALESCE(v_branch_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
          BEGIN
            INSERT INTO public.notifications(user_id, title, message, type, category, action_url, branch_id, metadata)
            VALUES (
              v_admin_id, 
              'Global Task Alert', 
              'New member request: ' || NEW.title, 
              'warning', 
              'task_alert', 
              '/tasks?id=' || NEW.id, 
              NEW.branch_id, 
              jsonb_build_object('task_id', NEW.id)
            );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_notify_broad_staff ON public.tasks;
CREATE TRIGGER trg_tasks_notify_broad_staff
AFTER INSERT OR UPDATE OF assigned_to, status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_notify_broad_staff();
