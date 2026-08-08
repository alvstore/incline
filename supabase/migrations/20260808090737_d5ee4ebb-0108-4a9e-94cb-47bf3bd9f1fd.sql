DELETE FROM public.settings WHERE branch_id IS NULL AND key = 'daily_ops_summary_recipients';
INSERT INTO public.settings (branch_id, key, value)
VALUES (
  NULL,
  'daily_ops_summary_recipients',
  '[{"name":"Yogita Lekhari","phone":"+919928910901","email":"yogitamotiramani@hotmail.com"},
    {"name":"Rajat Lekhari","phone":"+919887601200","email":"rajat.lekhari@hotmail.com"}]'::jsonb
);

DELETE FROM public.automation_rules WHERE key = 'daily_ops_summary';
INSERT INTO public.automation_rules
  (key, name, description, category, cron_expression, worker, worker_payload, is_active, is_system, use_ai)
VALUES (
  'daily_ops_summary',
  'Daily Owner Report (11 PM IST)',
  'Sends the end-of-day business summary to the owners: new memberships, total sales invoiced, amount received by payment mode, and dues collected vs outstanding.',
  'system',
  '30 17 * * *',
  'edge:daily-ops-summary',
  '{}'::jsonb,
  true,
  true,
  false
);