
-- Cron: reconcile RCS pending every 2 minutes
DO $mig$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'reconcile-rcs-pending-every-2min';
EXCEPTION WHEN OTHERS THEN NULL;
END $mig$;

SELECT cron.schedule(
  'reconcile-rcs-pending-every-2min',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/reconcile-rcs-pending',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo'
    ),
    body := jsonb_build_object('tick_at', now())
  );
  $cron$
);

-- Backfill: mark the two recent stuck RCS tests as failed with real reason
UPDATE public.communication_logs
SET delivery_status = 'failed',
    failed_at = now(),
    error_message = 'RCS undeliverable — recipient handset is not RCS-capable (Telinfy ERROR_CODE 404, WALLET 0). Consider SMS/WhatsApp for iPhone recipients on Indian carriers.',
    delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || jsonb_build_object(
      'telinfy_status', 'UN-DELIVERED',
      'telinfy_error_code', 404,
      'reconciled_at', now(),
      'backfill_reason', 'manual_audit_2026_07_15'
    )
WHERE channel = 'rcs'
  AND provider_record_id IN ('225331102','225331103')
  AND delivery_status = 'sent';
