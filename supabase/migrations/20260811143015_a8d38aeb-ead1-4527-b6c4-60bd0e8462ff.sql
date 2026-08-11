DROP VIEW IF EXISTS public.trainers_directory;

CREATE OR REPLACE FUNCTION public.trainers_directory_rows()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  branch_id uuid,
  specializations text[],
  certifications text[],
  bio text,
  is_active boolean,
  avatar_storage_path text,
  trainer_code text,
  weekly_off text,
  max_clients integer,
  biometric_enrolled boolean,
  mips_sync_status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.user_id, t.branch_id, t.specializations, t.certifications, t.bio,
         t.is_active, t.avatar_storage_path, t.trainer_code, t.weekly_off,
         t.max_clients, t.biometric_enrolled, t.mips_sync_status, t.created_at
  FROM public.trainers t
  WHERE has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
     OR t.user_id = auth.uid()
     OR (
          (has_role(auth.uid(), 'manager'::app_role)
            OR has_role(auth.uid(), 'staff'::app_role)
            OR has_role(auth.uid(), 'trainer'::app_role)
            OR has_role(auth.uid(), 'member'::app_role))
          AND t.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
        );
$$;

REVOKE ALL ON FUNCTION public.trainers_directory_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trainers_directory_rows() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trainers_directory_rows() TO service_role;

CREATE VIEW public.trainers_directory
WITH (security_invoker = on) AS
  SELECT * FROM public.trainers_directory_rows();

GRANT SELECT ON public.trainers_directory TO authenticated;
GRANT SELECT ON public.trainers_directory TO service_role;