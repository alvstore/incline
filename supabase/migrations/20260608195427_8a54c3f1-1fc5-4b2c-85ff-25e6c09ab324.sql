UPDATE public.ai_purposes
SET ops_config = (ops_config - 'schedule_minutes' - 'window_hours')
  || jsonb_build_object(
    'delay_hours', COALESCE(ops_config->>'delay_hours', '2')::int,
    'cooldown_hours', COALESCE(ops_config->>'cooldown_hours', '6')::int,
    'max_retries', COALESCE(ops_config->>'max_retries', '3')::int,
    'enabled', COALESCE((ops_config->>'enabled')::boolean, true)
  )
WHERE purpose = 'lead_nurture';