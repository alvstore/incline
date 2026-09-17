DROP POLICY "Staff can view scan consumptions" ON public.howbody_scan_consumptions;
CREATE POLICY "Staff can view scan consumptions"
ON public.howbody_scan_consumptions
FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = howbody_scan_consumptions.member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = howbody_scan_consumptions.member_id
      AND m.user_id = auth.uid()
  )
);