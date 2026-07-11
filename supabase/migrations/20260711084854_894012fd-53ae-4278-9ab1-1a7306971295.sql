
DROP POLICY IF EXISTS "Staff can insert device_commands" ON public.device_commands;
DROP POLICY IF EXISTS "Staff can update device_commands" ON public.device_commands;

CREATE POLICY "Staff can insert device_commands for their branch"
ON public.device_commands
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.access_devices d
      WHERE d.id = device_commands.device_id
        AND (d.branch_id IS NULL OR is_branch_member(d.branch_id))
    )
  )
);

CREATE POLICY "Staff can update device_commands for their branch"
ON public.device_commands
FOR UPDATE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.access_devices d
      WHERE d.id = device_commands.device_id
        AND (d.branch_id IS NULL OR is_branch_member(d.branch_id))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.access_devices d
      WHERE d.id = device_commands.device_id
        AND (d.branch_id IS NULL OR is_branch_member(d.branch_id))
    )
  )
);
