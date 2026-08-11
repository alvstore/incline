-- 1) Remove broad staff read of the trainers table (exposes gov ID / biometric / salary)
DROP POLICY IF EXISTS "Staff view branch active trainers" ON public.trainers;

-- 2) Safe directory view, security definer so staff can still read non-sensitive trainer data
DROP VIEW IF EXISTS public.trainers_directory;
CREATE VIEW public.trainers_directory
WITH (security_invoker = false) AS
SELECT
  t.id,
  t.user_id,
  t.branch_id,
  t.specializations,
  t.certifications,
  t.bio,
  t.is_active,
  t.avatar_storage_path,
  t.trainer_code,
  t.weekly_off,
  t.max_clients,
  t.biometric_enrolled,
  t.mips_sync_status,
  t.created_at
FROM public.trainers t
WHERE
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR t.user_id = auth.uid()
  OR (
    (
      public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'staff'::app_role)
      OR public.has_role(auth.uid(), 'trainer'::app_role)
      OR public.has_role(auth.uid(), 'member'::app_role)
    )
    AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );

REVOKE ALL ON public.trainers_directory FROM PUBLIC;
REVOKE ALL ON public.trainers_directory FROM anon;
GRANT SELECT ON public.trainers_directory TO authenticated;
GRANT SELECT ON public.trainers_directory TO service_role;

COMMENT ON VIEW public.trainers_directory IS
  'Non-sensitive trainer directory (no government ID, biometric photo URL, salary or rate columns). Security definer with an internal role + branch guard so front-desk staff can list trainers without reading trainer PII.';

-- 3) Membership action attempts: branch-scoped support access
DROP POLICY IF EXISTS "staff managers read branch membership attempts" ON public.membership_action_attempts;
CREATE POLICY "staff managers read branch membership attempts"
ON public.membership_action_attempts
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    (
      public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'staff'::app_role)
    )
    AND EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.id = membership_action_attempts.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);
