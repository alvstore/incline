
DROP POLICY IF EXISTS ai_dynamic_memory_select_authenticated ON public.ai_dynamic_memory;
CREATE POLICY ai_dynamic_memory_select_staff ON public.ai_dynamic_memory
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::app_role[]));

DROP POLICY IF EXISTS "View branch managers" ON public.branch_managers;
CREATE POLICY "View branch managers staff only" ON public.branch_managers
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::app_role[]));
