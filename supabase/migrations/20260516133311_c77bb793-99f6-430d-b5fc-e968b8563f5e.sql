CREATE POLICY "owners_admins_delete_ai_call_logs"
  ON public.ai_call_logs FOR DELETE
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ai_tool_logs' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'CREATE POLICY "owners_admins_delete_ai_tool_logs"
      ON public.ai_tool_logs FOR DELETE
      USING (has_any_role(auth.uid(), ARRAY[''owner''::app_role, ''admin''::app_role]))';
  END IF;
END $$;