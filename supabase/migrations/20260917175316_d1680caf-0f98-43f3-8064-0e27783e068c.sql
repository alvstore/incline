
INSERT INTO public.automation_rules (key, name, description, category, cron_expression, worker, worker_payload, is_active, is_system)
SELECT 'mips_device_watchdog',
       'Gate Restart Watchdog',
       'Polls the gate server every 5 minutes and logs offline, recovery and suspected terminal restarts with the dispatch traffic that preceded them.',
       'system',
       '*/5 * * * *',
       'edge:mips-device-watchdog',
       '{"triggered_by":"automation-brain"}'::jsonb,
       true,
       true
WHERE NOT EXISTS (SELECT 1 FROM public.automation_rules WHERE key = 'mips_device_watchdog');
