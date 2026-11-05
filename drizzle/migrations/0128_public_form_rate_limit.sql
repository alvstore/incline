CREATE TABLE IF NOT EXISTS public.public_form_rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
GRANT ALL ON public.public_form_rate_limits TO service_role;
ALTER TABLE public.public_form_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS public_form_rate_limits_window_idx ON public.public_form_rate_limits (window_start);
COMMENT ON TABLE public.public_form_rate_limits IS 'Fixed-window counters for public (unauthenticated) form endpoints. Keys are hashed; service-role only.';

CREATE OR REPLACE FUNCTION public.hit_public_form_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
BEGIN
  INSERT INTO public.public_form_rate_limits (key, window_start, count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = public.public_form_rate_limits.count + 1
  RETURNING count INTO v_count;
  DELETE FROM public.public_form_rate_limits WHERE window_start < now() - interval '1 day' AND key = p_key;
  RETURN v_count <= p_limit;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hit_public_form_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hit_public_form_rate_limit(text, integer, integer) TO service_role;