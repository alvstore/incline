CREATE POLICY "No client access to template manager state"
ON public.template_manager_state
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);