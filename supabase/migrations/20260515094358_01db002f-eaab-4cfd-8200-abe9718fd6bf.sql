
-- 1. Promote single-active provider rows to default
UPDATE public.ai_provider_configs a SET is_default = true
WHERE is_active = true AND is_default = false
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_provider_configs b
    WHERE b.scope = a.scope AND b.is_active = true AND b.is_default = true
  );

-- 2. Enforce at most one default per scope
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_default_per_scope
  ON public.ai_provider_configs (scope) WHERE is_default = true;

-- 3. Atomic helper to set default for a scope
CREATE OR REPLACE FUNCTION public.set_default_ai_provider(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner'::app_role)
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT scope INTO v_scope FROM public.ai_provider_configs WHERE id = p_id;
  IF v_scope IS NULL THEN RAISE EXCEPTION 'provider not found'; END IF;

  UPDATE public.ai_provider_configs
     SET is_default = false, updated_at = now()
   WHERE scope = v_scope AND is_default = true AND id <> p_id;

  UPDATE public.ai_provider_configs
     SET is_default = true, is_active = true, updated_at = now()
   WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_default_ai_provider(uuid) TO authenticated;
