CREATE POLICY "Owners and admins update classes" ON public.classes FOR UPDATE TO authenticated
USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])))
WITH CHECK ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])));