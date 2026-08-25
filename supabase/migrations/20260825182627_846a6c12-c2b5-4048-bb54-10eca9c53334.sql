UPDATE public.templates
SET variables = '["recipient_name", "plan_name", "branch_name"]'::jsonb,
    updated_at = now()
WHERE id = '102270d2-eea5-4442-b5a6-b0c9eadc06ca'
  AND meta_template_name = 'diet_plan_document_v1'
  AND trigger_event = 'diet_plan_ready';