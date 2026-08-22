CREATE OR REPLACE FUNCTION public.get_my_trainers()
RETURNS TABLE(
  trainer_id uuid,
  full_name text,
  avatar_url text,
  trainer_code text,
  specializations text[],
  relation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT m.id, m.assigned_trainer_id
    FROM public.members m
    WHERE m.user_id = auth.uid()
  ),
  linked AS (
    SELECT me.assigned_trainer_id AS tid, 'assigned'::text AS relation FROM me WHERE me.assigned_trainer_id IS NOT NULL
    UNION
    SELECT mpp.trainer_id, 'pt_package'::text
      FROM public.member_pt_packages mpp
      JOIN me ON me.id = mpp.member_id
     WHERE mpp.trainer_id IS NOT NULL
    UNION
    SELECT ps.trainer_id, 'pt_session'::text
      FROM public.pt_sessions ps
      JOIN public.member_pt_packages mpp2 ON mpp2.id = ps.member_pt_package_id
      JOIN me ON me.id = mpp2.member_id
     WHERE ps.trainer_id IS NOT NULL
  )
  SELECT DISTINCT ON (t.id)
         t.id,
         COALESCE(p.full_name, 'Trainer')::text,
         p.avatar_url::text,
         t.trainer_code::text,
         t.specializations,
         l.relation
    FROM linked l
    JOIN public.trainers t ON t.id = l.tid
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE auth.uid() IS NOT NULL
   ORDER BY t.id, l.relation;
$function$;

REVOKE ALL ON FUNCTION public.get_my_trainers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_trainers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_trainers() TO service_role;