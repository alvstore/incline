UPDATE public.ai_purposes
SET ops_config = COALESCE(ops_config, '{}'::jsonb) || jsonb_build_object(
  'channels', jsonb_build_object(
    'whatsapp',  jsonb_build_object('enabled', true),
    'instagram', jsonb_build_object('enabled', true),
    'messenger', jsonb_build_object('enabled', true)
  )
)
WHERE purpose = 'whatsapp_reply'
  AND NOT (COALESCE(ops_config, '{}'::jsonb) ? 'channels');