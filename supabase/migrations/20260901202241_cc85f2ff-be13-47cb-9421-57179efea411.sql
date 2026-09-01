DROP FUNCTION IF EXISTS public.notification_recipients(uuid, text);

CREATE FUNCTION public.notification_recipients(p_branch_id uuid, p_category text DEFAULT NULL::text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT r.u_id AS user_id
  FROM (
    SELECT ur.user_id AS u_id FROM public.user_roles ur WHERE ur.role IN ('owner','admin')
    UNION
    SELECT bm.user_id FROM public.branch_managers bm WHERE bm.branch_id = p_branch_id
    UNION
    SELECT sb.user_id FROM public.staff_branches sb WHERE sb.branch_id = p_branch_id
  ) r
  WHERE r.u_id IS NOT NULL
    -- pure trainers only get coaching-relevant categories
    AND (
      COALESCE(p_category,'') IN ('class','announcement','task','task_assigned','task_overdue','pt_payment')
      OR NOT public.is_pure_trainer(r.u_id)
    );
$function$;