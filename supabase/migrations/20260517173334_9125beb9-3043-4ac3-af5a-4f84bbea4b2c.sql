
-- 1. TRAINERS: remove blanket authenticated SELECT; expose safe directory view
DROP POLICY IF EXISTS "Authenticated read active trainers" ON public.trainers;

CREATE OR REPLACE VIEW public.trainers_directory
WITH (security_invoker = false) AS
SELECT
  id, user_id, branch_id, specializations, certifications, bio,
  is_active, avatar_storage_path, trainer_code, weekly_off, max_clients
FROM public.trainers
WHERE is_active = true;

REVOKE ALL ON public.trainers_directory FROM PUBLIC;
REVOKE ALL ON public.trainers_directory FROM anon;
GRANT SELECT ON public.trainers_directory TO authenticated;

COMMENT ON VIEW public.trainers_directory IS
  'Safe member-visible projection of trainers. Excludes salary, hourly rate, commission %, government ID. Owner-defined view; RLS on trainers stays role-scoped.';

-- 2. DEVICE_COMMANDS: branch via access_devices.branch_id
DROP POLICY IF EXISTS "Authenticated users can read device_commands" ON public.device_commands;

CREATE POLICY "Staff can read device_commands for their branch"
ON public.device_commands
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.access_devices d
      WHERE d.id = device_commands.device_id
        AND (d.branch_id IS NULL OR public.is_branch_member(d.branch_id))
    )
  )
);

-- 3. WHATSAPP_MESSAGES: scope staff clause to their branch
DROP POLICY IF EXISTS "Staff can view whatsapp messages for their branches" ON public.whatsapp_messages;

CREATE POLICY "Staff can view whatsapp messages for their branches"
ON public.whatsapp_messages
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND public.is_branch_member(branch_id)
  )
);
