
-- Fix automation-brain cron auth: brain v2.2.0 requires service-role bearer + x-system-call header.
-- Old cron sent only anon apikey → 401 since Jun 11 09:50 UTC → all 15 rules frozen.
SELECT cron.unschedule('automation-brain-tick');

SELECT cron.schedule(
  'automation-brain-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/automation-brain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.service_role_key', true),
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'x-system-call', 'automation-brain'
    ),
    body := jsonb_build_object('source','cron','ts', now()),
    timeout_milliseconds := 55000
  );
  $$
);

-- Force-due all backlogged rules so the next tick processes them immediately.
UPDATE public.automation_rules
SET next_run_at = now()
WHERE is_active = true
  AND (next_run_at IS NULL OR next_run_at < now() - interval '30 minutes');

-- Backfill Rahul's lead so nurture picks him up.
UPDATE public.leads
SET email = 'Rahulchaudhary872@gmail.com',
    full_name = COALESCE(NULLIF(full_name, ''), 'Rahul'),
    last_contacted_at = '2026-06-10 17:25:32+00',
    updated_at = now()
WHERE id = 'c33b3f77-305f-4999-acdc-af96a7de4d2e'
  AND email IS NULL;
