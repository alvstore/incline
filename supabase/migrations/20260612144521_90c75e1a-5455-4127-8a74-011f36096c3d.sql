
SELECT cron.unschedule('automation-brain-tick');

SELECT cron.schedule(
  'automation-brain-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/automation-brain',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo","x-system-call":"automation-brain"}'::jsonb,
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

UPDATE public.automation_rules
SET next_run_at = now()
WHERE is_active = true
  AND (next_run_at IS NULL OR next_run_at < now() - interval '30 minutes');
