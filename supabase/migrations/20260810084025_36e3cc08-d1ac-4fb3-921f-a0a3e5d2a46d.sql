INSERT INTO public.templates (
  branch_id,
  name,
  type,
  content,
  variables,
  is_active,
  trigger_event,
  meta_template_name,
  meta_template_status,
  header_type
)
SELECT
  '11111111-1111-1111-1111-111111111111'::uuid,
  'daily_ops_summary_v1',
  'whatsapp',
  'Incline daily report for {{report_date}}. New memberships: {{new_memberships}}. Total sales: INR {{total_sales}}. Amount received: INR {{amount_received}}. Cash: INR {{cash_received}}. UPI: INR {{upi_received}}. Card: INR {{card_received}}. Dues collected: INR {{dues_collected}}. Outstanding dues: INR {{dues_pending}}.',
  '["report_date","new_memberships","total_sales","amount_received","cash_received","upi_received","card_received","dues_collected","dues_pending"]'::jsonb,
  true,
  'daily_ops_summary',
  'daily_ops_summary_v1',
  'DRAFT',
  'none'
WHERE NOT EXISTS (
  SELECT 1 FROM public.templates
  WHERE branch_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND type = 'whatsapp'
    AND trigger_event = 'daily_ops_summary'
);

INSERT INTO public.whatsapp_triggers (branch_id, event_name, template_id, delay_minutes, is_active)
SELECT t.branch_id, 'daily_ops_summary', t.id, 0, true
FROM public.templates t
WHERE t.branch_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND t.type = 'whatsapp'
  AND t.trigger_event = 'daily_ops_summary'
ON CONFLICT (branch_id, event_name)
DO UPDATE SET template_id = EXCLUDED.template_id, delay_minutes = 0, is_active = true, updated_at = now();