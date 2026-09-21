ALTER TABLE public.access_device_health_events
  DROP CONSTRAINT IF EXISTS access_device_health_events_event_type_check;

ALTER TABLE public.access_device_health_events
  ADD CONSTRAINT access_device_health_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'offline'::text,
    'recovered'::text,
    'restart_suspected'::text,
    'watchdog_error'::text,
    'dispatch_storm'::text,
    'heartbeat_gap'::text
  ]));

CREATE INDEX IF NOT EXISTS idx_adhe_device_type_detected
  ON public.access_device_health_events (device_id, event_type, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_msa_device_dispatch_created
  ON public.mips_sync_attempts (device_id, created_at DESC)
  WHERE operation = 'device_dispatch';