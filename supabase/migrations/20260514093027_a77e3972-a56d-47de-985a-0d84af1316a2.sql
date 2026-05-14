-- Wave B: send-time race lock + signed presence helpers
CREATE TABLE IF NOT EXISTS public.whatsapp_send_locks (
  phone_number text PRIMARY KEY,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

ALTER TABLE public.whatsapp_send_locks ENABLE ROW LEVEL SECURITY;

-- service role only (no policies for anon/authenticated → effectively locked down)
DROP POLICY IF EXISTS "service role manages send locks" ON public.whatsapp_send_locks;

CREATE OR REPLACE FUNCTION public.try_whatsapp_send_lock(
  _phone text,
  _ttl_seconds int DEFAULT 8
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired boolean := false;
BEGIN
  -- Sweep stale locks for this phone
  DELETE FROM public.whatsapp_send_locks
   WHERE phone_number = _phone AND expires_at < now();

  INSERT INTO public.whatsapp_send_locks(phone_number, expires_at)
  VALUES (_phone, now() + make_interval(secs => _ttl_seconds))
  ON CONFLICT (phone_number) DO NOTHING
  RETURNING true INTO acquired;

  RETURN COALESCE(acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_whatsapp_send_lock(_phone text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.whatsapp_send_locks WHERE phone_number = _phone;
$$;

REVOKE ALL ON FUNCTION public.try_whatsapp_send_lock(text, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_whatsapp_send_lock(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_whatsapp_send_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_whatsapp_send_lock(text) TO service_role;