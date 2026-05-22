
WITH org AS (
  SELECT whatsapp_ai_config, lead_nurture_config, ai_tool_config
  FROM public.organization_settings
  WHERE branch_id IS NULL
  LIMIT 1
),
org_fallback AS (
  SELECT whatsapp_ai_config, lead_nurture_config, ai_tool_config
  FROM public.organization_settings
  ORDER BY (branch_id IS NULL) DESC
  LIMIT 1
),
src AS (
  SELECT
    COALESCE((SELECT whatsapp_ai_config FROM org),  (SELECT whatsapp_ai_config FROM org_fallback), '{}'::jsonb) AS wa,
    COALESCE((SELECT lead_nurture_config FROM org), (SELECT lead_nurture_config FROM org_fallback), '{}'::jsonb) AS ln,
    COALESCE((SELECT ai_tool_config FROM org),      (SELECT ai_tool_config FROM org_fallback), '{}'::jsonb) AS tools
)
UPDATE public.ai_purposes p
SET ops_config = CASE p.purpose
    WHEN 'whatsapp_reply' THEN jsonb_build_object(
      'auto_reply_enabled',            COALESCE((src.wa->>'auto_reply_enabled')::boolean, true),
      'reply_delay_seconds',           COALESCE((src.wa->>'reply_delay_seconds')::int, 0),
      'instagram_story_reply_enabled', COALESCE((src.wa->>'instagram_story_reply_enabled')::boolean, false),
      'instagram_auto_reply_comments', COALESCE((src.wa->>'instagram_auto_reply_comments')::boolean, false),
      'ai_flow_rules',                 COALESCE(src.wa->'ai_flow_rules', '[]'::jsonb)
    )
    WHEN 'lead_nurture' THEN jsonb_build_object(
      'enabled',        COALESCE((src.ln->>'enabled')::boolean, true),
      'delay_hours',    COALESCE((src.ln->>'delay_hours')::int, 4),
      'max_retries',    COALESCE((src.ln->>'max_retries')::int, 2),
      'cooldown_hours', COALESCE((src.ln->>'cooldown_hours')::int, (src.ln->>'delay_hours')::int, 4)
    )
    ELSE p.ops_config
  END,
  tools_allowed = CASE
    WHEN p.purpose = 'whatsapp_reply' THEN COALESCE(
      (SELECT array_agg(t.key) FROM jsonb_each_text(src.tools) t WHERE t.value::boolean = true),
      p.tools_allowed
    )
    ELSE p.tools_allowed
  END
FROM src
WHERE p.purpose IN ('whatsapp_reply','lead_nurture');

UPDATE public.ai_purposes
SET enabled = COALESCE((ops_config->>'auto_reply_enabled')::boolean, enabled)
WHERE purpose = 'whatsapp_reply';

ALTER TABLE public.organization_settings
  DROP COLUMN IF EXISTS whatsapp_ai_config,
  DROP COLUMN IF EXISTS lead_nurture_config,
  DROP COLUMN IF EXISTS ai_tool_config;

ALTER TABLE public.ai_purposes
  DROP COLUMN IF EXISTS allowed_tools;
