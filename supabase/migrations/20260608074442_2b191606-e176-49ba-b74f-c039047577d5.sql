UPDATE public.ai_purposes
SET
  provider_id = (
    SELECT id FROM public.ai_provider_configs
    WHERE is_active = true AND is_default = true AND scope = 'all'
    ORDER BY updated_at DESC LIMIT 1
  ),
  model = COALESCE(NULLIF(model, ''), 'google/gemini-3-flash-preview'),
  updated_at = now()
WHERE purpose = 'whatsapp_reply'
  AND branch_id IS NULL
  AND provider_id IS NULL;