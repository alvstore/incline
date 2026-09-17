
ALTER TABLE public.access_devices
  ADD COLUMN IF NOT EXISTS last_offline_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_restart_at timestamptz,
  ADD COLUMN IF NOT EXISTS restart_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.access_device_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid,
  device_id uuid REFERENCES public.access_devices(id) ON DELETE CASCADE,
  serial_number text,
  device_name text,
  event_type text NOT NULL CHECK (event_type IN ('offline','recovered','restart_suspected','watchdog_error')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  offline_seconds integer,
  dispatches_before integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adhe_device_time ON public.access_device_health_events (device_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_adhe_branch_time ON public.access_device_health_events (branch_id, detected_at DESC);

GRANT SELECT ON public.access_device_health_events TO authenticated;
GRANT ALL ON public.access_device_health_events TO service_role;

ALTER TABLE public.access_device_health_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read gate health events" ON public.access_device_health_events;
CREATE POLICY "Staff can read gate health events"
ON public.access_device_health_events
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']));
