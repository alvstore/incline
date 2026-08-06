UPDATE public.templates t
SET header_type = 'none', updated_at = now()
FROM public.whatsapp_templates w
WHERE t.type = 'whatsapp'
  AND t.meta_template_name = w.name
  AND t.header_type = 'document'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.components, '[]'::jsonb)) c
    WHERE upper(c->>'type') = 'HEADER' AND upper(COALESCE(c->>'format','')) = 'DOCUMENT'
  );