INSERT INTO public.automation_rules (
  branch_id, key, name, description, category, worker, worker_payload,
  cron_expression, is_active, is_system, use_ai, next_run_at
)
SELECT
  NULL,
  'template_manager_monitor',
  'Template Manager Monitor',
  'Reconciles the approved Meta template catalog and repairs missing system-event mappings in bounded batches.',
  'communications',
  'edge:template-manager-worker',
  '{}'::jsonb,
  '17 2 * * *',
  true,
  true,
  false,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.automation_rules WHERE key = 'template_manager_monitor' AND branch_id IS NULL
);

WITH welcome_template AS (
  SELECT DISTINCT ON (t.branch_id)
    t.branch_id,
    t.id AS template_id
  FROM public.templates t
  WHERE t.type = 'whatsapp'
    AND t.is_active = true
    AND upper(coalesce(t.meta_template_status, '')) = 'APPROVED'
    AND (
      t.trigger_event = 'member_created'
      OR t.meta_template_name IN ('welcome_incline_fitness', 'welcome_new_member')
      OR t.name IN ('welcome_incline_fitness', 'welcome_new_member')
    )
  ORDER BY t.branch_id,
    CASE WHEN t.meta_template_name = 'welcome_new_member' THEN 0 ELSE 1 END,
    t.updated_at DESC NULLS LAST
)
INSERT INTO public.whatsapp_triggers (branch_id, event_name, template_id, is_active)
SELECT branch_id, 'member_created', template_id, true
FROM welcome_template
ON CONFLICT (branch_id, event_name)
DO UPDATE SET
  template_id = EXCLUDED.template_id,
  is_active = true,
  updated_at = now();