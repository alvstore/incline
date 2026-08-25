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
  v_max_hourly  int;
BEGIN
  IF _recipient IS NULL OR _channel IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- Channel-aware recipient key. Digit-stripping is only valid for phone
  -- channels; an email address has no digits, which used to collapse EVERY
  -- email recipient into one shared bucket and cap the whole club at 12/hour.
  IF _channel IN ('email') THEN
    v_norm := lower(btrim(_recipient));
  ELSE
    v_norm := regexp_replace(coalesce(_recipient, ''), '[^0-9]', '', 'g');
    IF length(v_norm) > 10 THEN
      v_norm := right(v_norm, 10);
    END IF;
  END IF;

  IF v_norm = '' THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- Per-recipient hourly ceiling. Email has no Meta pacing risk, so it only
  -- needs a sane anti-loop guard, not the WhatsApp ecosystem cap.
  v_max_hourly := CASE WHEN _channel = 'email' THEN 40 ELSE 12 END;

  v_max_ident := CASE
    WHEN _category IN ('new_lead', 'task_assigned', 'ops_alert', 'system_alert') THEN 1
    ELSE 3
  END;

  -- transactional traffic is never budget-capped
  IF _category IN ('otp', 'payment_receipt', 'invoice', 'password_reset') THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- Broadcast/marketing bodies are identical by design — the identical-content
  -- guard exists to stop retry loops, not campaigns.
  IF _category IN ('marketing', 'announcement', 'campaign') THEN
    v_max_ident := 1000000;
  END IF;

  SELECT count(*) INTO v_identical
  FROM public.communication_logs
  WHERE type = _channel
    AND created_at > now() - interval '24 hours'
    AND CASE
          WHEN _channel = 'email' THEN lower(btrim(coalesce(recipient, '')))
          ELSE right(regexp_replace(coalesce(recipient,''), '[^0-9]', '', 'g'), 10)
        END = v_norm
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
    AND CASE
          WHEN _channel = 'email' THEN lower(btrim(coalesce(recipient, '')))
          ELSE right(regexp_replace(coalesce(recipient,''), '[^0-9]', '', 'g'), 10)
        END = v_norm
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

-- Reaper: an SMTP hang or worker timeout leaves a log stuck in 'sending'
-- forever, which hides failures and blocks retries. Terminalise anything
-- older than 15 minutes.
CREATE OR REPLACE FUNCTION public.reap_stuck_communication_logs(_older_than_minutes int DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.communication_logs
  SET status = 'failed',
      delivery_status = 'failed',
      error_message = COALESCE(error_message, 'send_timeout: provider never returned (reaped)')
  WHERE coalesce(delivery_status::text, status::text) = 'sending'
    AND created_at < now() - make_interval(mins => _older_than_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('reaped', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reap_stuck_communication_logs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reap_stuck_communication_logs(int) TO service_role;