-- Backfill stub `templates` rows for every approved Meta WhatsApp template that has no CRM row yet.
-- This makes the Campaign Wizard picker (which queries `templates`) immediately surface
-- templates that were created directly in Meta or via AI generate without local insert.
INSERT INTO public.templates (
  branch_id, type, name, content,
  meta_template_name, meta_template_status, header_type, is_active
)
SELECT
  wt.branch_id,
  'whatsapp',
  wt.name,
  COALESCE(
    (SELECT (c->>'text')
       FROM jsonb_array_elements(wt.components) c
       WHERE c->>'type' = 'BODY'
       LIMIT 1),
    ''
  ) AS content,
  wt.name,
  wt.status,
  LOWER(COALESCE(
    (SELECT (c->>'format')
       FROM jsonb_array_elements(wt.components) c
       WHERE c->>'type' = 'HEADER'
       LIMIT 1),
    'none'
  )) AS header_type,
  true
FROM public.whatsapp_templates wt
WHERE wt.status = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM public.templates t
    WHERE t.meta_template_name = wt.name
  );