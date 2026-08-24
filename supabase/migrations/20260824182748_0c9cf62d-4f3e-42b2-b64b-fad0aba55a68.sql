-- 1) Index supporting budget lookups
CREATE INDEX IF NOT EXISTS idx_comm_logs_recipient_type_created
  ON public.communication_logs (recipient, type, created_at DESC);

-- 2) WhatsApp health / circuit breaker state
CREATE TABLE IF NOT EXISTS public.whatsapp_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id text NOT NULL UNIQUE,
  pacing_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  breaker_open_until timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  probe_ok_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_health TO authenticated;
GRANT ALL ON public.whatsapp_health TO service_role;

ALTER TABLE public.whatsapp_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins can read whatsapp health"
  ON public.whatsapp_health FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_whatsapp_health_updated_at ON public.whatsapp_health;
CREATE TRIGGER trg_whatsapp_health_updated_at
  BEFORE UPDATE ON public.whatsapp_health
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Send budget gate
CREATE OR REPLACE FUNCTION public.communication_send_allowed(
  _recipient text,
  _channel   text,
  _category  text DEFAULT NULL,
  _content   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm        text;
  v_identical   int := 0;
  v_hourly      int := 0;
  v_max_ident   int;
  v_max_hourly  int := 12;
BEGIN
  IF _recipient IS NULL OR _channel IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  v_norm := regexp_replace(coalesce(_recipient, ''), '[^0-9]', '', 'g');
  IF length(v_norm) > 10 THEN
    v_norm := right(v_norm, 10);
  END IF;

  v_max_ident := CASE
    WHEN _category IN ('new_lead', 'task_assigned', 'ops_alert', 'system_alert') THEN 1
    ELSE 3
  END;

  -- transactional traffic is never budget-capped
  IF _category IN ('otp', 'payment_receipt', 'invoice', 'password_reset') THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  SELECT count(*) INTO v_identical
  FROM public.communication_logs
  WHERE type = _channel
    AND created_at > now() - interval '24 hours'
    AND right(regexp_replace(coalesce(recipient,''), '[^0-9]', '', 'g'), 10) = v_norm
    AND (_content IS NULL OR md5(coalesce(content,'')) = md5(_content))
    AND coalesce(delivery_status::text, '') NOT IN ('suppressed', 'deduped', 'skipped');

  IF v_identical >= v_max_ident THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'budget_exceeded',
      'detail', format('%s identical %s sends in last 24h (cap %s)', v_identical, _channel, v_max_ident)
    );
  END IF;

  SELECT count(*) INTO v_hourly
  FROM public.communication_logs
  WHERE type = _channel
    AND created_at > now() - interval '1 hour'
    AND right(regexp_replace(coalesce(recipient,''), '[^0-9]', '', 'g'), 10) = v_norm
    AND coalesce(delivery_status::text, '') NOT IN ('suppressed', 'deduped', 'skipped');

  IF v_hourly >= v_max_hourly THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'hourly_ceiling',
      'detail', format('%s %s sends in last hour (cap %s)', v_hourly, _channel, v_max_hourly)
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'identical_24h', v_identical, 'hourly', v_hourly);
END;
$$;

REVOKE ALL ON FUNCTION public.communication_send_allowed(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_send_allowed(text, text, text, text) TO service_role;

-- 4) Circuit breaker helpers
CREATE OR REPLACE FUNCTION public.whatsapp_record_pacing_error(
  _phone_number_id text,
  _error_code      text DEFAULT '131049'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.whatsapp_health%ROWTYPE;
  v_errors jsonb;
  v_recent int;
BEGIN
  IF _phone_number_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_phone_number_id');
  END IF;

  INSERT INTO public.whatsapp_health (phone_number_id)
  VALUES (_phone_number_id)
  ON CONFLICT (phone_number_id) DO NOTHING;

  SELECT * INTO v_row FROM public.whatsapp_health WHERE phone_number_id = _phone_number_id;

  SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_errors
  FROM jsonb_array_elements_text(coalesce(v_row.pacing_errors, '[]'::jsonb)) e
  WHERE (e)::timestamptz > now() - interval '1 hour';

  v_errors := v_errors || to_jsonb(now()::text);
  v_recent := jsonb_array_length(v_errors);

  UPDATE public.whatsapp_health
     SET pacing_errors     = v_errors,
         last_error_at     = now(),
         last_error_code   = _error_code,
         breaker_open_until = CASE
           WHEN v_recent >= 5 THEN greatest(coalesce(breaker_open_until, now()), now() + interval '6 hours')
           ELSE breaker_open_until
         END,
         updated_at        = now()
   WHERE phone_number_id = _phone_number_id;

  RETURN jsonb_build_object('ok', true, 'recent_errors', v_recent, 'breaker_open', v_recent >= 5);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_record_pacing_error(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_pacing_error(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_breaker_open(_phone_number_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_health
    WHERE phone_number_id = _phone_number_id
      AND breaker_open_until IS NOT NULL
      AND breaker_open_until > now()
  );
$$;

REVOKE ALL ON FUNCTION public.whatsapp_breaker_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_breaker_open(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_breaker_open(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.whatsapp_breaker_close(_phone_number_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_health
     SET breaker_open_until = NULL,
         pacing_errors = '[]'::jsonb,
         probe_ok_at = now(),
         updated_at = now()
   WHERE phone_number_id = _phone_number_id;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_breaker_close(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_breaker_close(text) TO service_role;