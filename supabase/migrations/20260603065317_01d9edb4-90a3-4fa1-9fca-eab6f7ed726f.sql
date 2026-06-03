-- Fix 1: Remove anonymous INSERT path on device_access_events. Hardware writes should go through edge functions with service role.
DROP POLICY IF EXISTS "System insert access events" ON public.device_access_events;
CREATE POLICY "System insert access events"
ON public.device_access_events
FOR INSERT
TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]));

-- Fix 2: Branch-scope reads of staff_whatsapp_routing so a manager/trainer in branch A
-- cannot read personal phone numbers of staff in other branches. Owners/admins keep global visibility.
DROP POLICY IF EXISTS "Staff can view routing in branch" ON public.staff_whatsapp_routing;
CREATE POLICY "Staff can view routing in branch"
ON public.staff_whatsapp_routing
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);