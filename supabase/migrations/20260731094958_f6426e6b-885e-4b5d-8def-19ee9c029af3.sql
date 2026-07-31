DROP POLICY IF EXISTS "Owners admins managers view access events" ON public.device_access_events;
DROP POLICY IF EXISTS "Owners admins managers insert access events" ON public.device_access_events;

CREATE POLICY "Owners admins view access events"
ON public.device_access_events FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Owners admins insert access events"
ON public.device_access_events FOR INSERT
WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers view access events in their branches"
ON public.device_access_events FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['manager'::app_role])
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Managers insert access events in their branches"
ON public.device_access_events FOR INSERT
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['manager'::app_role])
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);