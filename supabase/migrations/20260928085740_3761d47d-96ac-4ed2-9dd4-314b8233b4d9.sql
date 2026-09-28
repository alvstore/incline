-- Enable the renewal engine + automatic voice escalation (global row).
UPDATE public.renewal_engine_config
SET enabled = true,
    voice_auto_call_enabled = true,
    updated_at = now()
WHERE branch_id IS NULL;

-- The renewal tick ran at 02:30 UTC (08:00 IST), before the 10:00 IST calling
-- window opens, so every voice escalation was rejected as outside_window.
-- Move it to 05:00 UTC = 10:30 IST.
UPDATE public.automation_rules
SET cron_expression = '0 5 * * *',
    updated_at = now()
WHERE key = 'renewal_engine_tick';
