-- 1. Fix has_role permission denied
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;

-- 2. Fix tasks_notify_management trigger (staff_id -> user_id)
CREATE OR REPLACE FUNCTION public.tasks_notify_management()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_task_title text;
  v_assigned_to_name text;
BEGIN
  -- Get context
  v_branch_id := NEW.branch_id;
  v_task_title := NEW.title;
  
  -- Get assignee name if exists
  IF NEW.assigned_to IS NOT NULL THEN
    SELECT full_name INTO v_assigned_to_name FROM public.profiles WHERE id = NEW.assigned_to;
  END IF;

  -- Notify relevant staff (owners, admins, and branch managers)
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

  RETURN NEW;
END;
$function$;

-- 3. Hardening holidays RLS (restrict to staff roles)
DROP POLICY IF EXISTS "holidays_read_all" ON public.holidays;
DROP POLICY IF EXISTS "holidays_read_staff" ON public.holidays;

CREATE POLICY "holidays_read_staff"
ON public.holidays
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role, 'trainer'::public.app_role]));

-- 4. Hardening income/expense templates RLS
DROP POLICY IF EXISTS "income_categories_open_read" ON public.income_categories;
DROP POLICY IF EXISTS "income_categories_staff_read" ON public.income_categories;

CREATE POLICY "income_categories_staff_read"
ON public.income_categories
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

DROP POLICY IF EXISTS "expense_category_templates_open_read" ON public.expense_category_templates;
DROP POLICY IF EXISTS "expense_category_templates_staff_read" ON public.expense_category_templates;

CREATE POLICY "expense_category_templates_staff_read"
ON public.expense_category_templates
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

-- 5. Storage Scoping (bucket policies)
-- Note: Storage policies are on storage.objects

-- member-media protection
DROP POLICY IF EXISTS "Authorized users can view member media" ON storage.objects;
CREATE POLICY "Authorized users can view member media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'member-media' AND public.can_access_private_member_media(auth.uid(), name));

DROP POLICY IF EXISTS "Authorized users can upload member media" ON storage.objects;
CREATE POLICY "Authorized users can upload member media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'member-media' AND public.can_access_private_member_media(auth.uid(), name));

-- staff-media protection
DROP POLICY IF EXISTS "Authorized users can view staff media" ON storage.objects;
CREATE POLICY "Authorized users can view staff media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'staff-media' AND public.can_access_private_staff_media(auth.uid(), name));

-- policy-pdfs protection
DROP POLICY IF EXISTS "policy_pdfs_read_scoped" ON storage.objects;
CREATE POLICY "policy_pdfs_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'policy-pdfs' AND public.can_read_policy_pdf(name));

-- Re-grant on tables just in case
GRANT SELECT ON public.holidays TO authenticated;
GRANT SELECT ON public.income_categories TO authenticated;
GRANT SELECT ON public.expense_category_templates TO authenticated;
