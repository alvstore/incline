CREATE TABLE IF NOT EXISTS public.whatsapp_recipient_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_last10 text NOT NULL UNIQUE,
  phone text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  last_marketing_attempt_at timestamptz,
  last_marketing_delivered_at timestamptz,
  last_marketing_read_at timestamptz,
  last_reply_at timestamptz,
  last_pace_limited_at timestamptz,
  last_meta_error_code text,
  pace_events_30d integer NOT NULL DEFAULT 0,
  marketing_cooldown_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_recipient_state TO authenticated;
GRANT ALL ON public.whatsapp_recipient_state TO service_role;

ALTER TABLE public.whatsapp_recipient_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read recipient state in scope"
ON public.whatsapp_recipient_state
FOR SELECT
TO authenticated
USING (
  branch_id IS NULL
  OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
);

CREATE INDEX IF NOT EXISTS idx_wa_recipient_state_cooldown
  ON public.whatsapp_recipient_state (marketing_cooldown_until)
  WHERE marketing_cooldown_until IS NOT NULL;

CREATE TRIGGER trg_wa_recipient_state_updated_at
BEFORE UPDATE ON public.whatsapp_recipient_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.whatsapp_pace_cooldown_hours()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF((value #>> '{}'), '')::integer
       FROM public.settings
      WHERE key = 'whatsapp_marketing_cooldown_hours'
      LIMIT 1),
    24
  );
$$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_pace_event(
  _phone text,
  _code text DEFAULT '131049',
  _branch_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last10 text := right(regexp_replace(COALESCE(_phone, ''), '\D', '', 'g'), 10);
  v_base integer := public.whatsapp_pace_cooldown_hours();
  v_recent integer;
  v_until timestamptz;
BEGIN
  IF length(v_last10) < 10 THEN
    RETURN NULL;
  END IF;

  SELECT CASE
           WHEN last_pace_limited_at IS NULL OR last_pace_limited_at < now() - interval '30 days'
             THEN 0
           ELSE pace_events_30d
         END
    INTO v_recent
    FROM public.whatsapp_recipient_state
   WHERE phone_last10 = v_last10;

  v_recent := COALESCE(v_recent, 0) + 1;
  v_until := now() + LEAST(v_base * power(2, LEAST(v_recent - 1, 6)), 336) * interval '1 hour';

  INSERT INTO public.whatsapp_recipient_state AS s (
    phone_last10, phone, branch_id, last_pace_limited_at,
    last_meta_error_code, pace_events_30d, marketing_cooldown_until
  )
  VALUES (v_last10, _phone, _branch_id, now(), _code, v_recent, v_until)
  ON CONFLICT (phone_last10) DO UPDATE
     SET last_pace_limited_at = now(),
         last_meta_error_code = EXCLUDED.last_meta_error_code,
         pace_events_30d = v_recent,
         marketing_cooldown_until = GREATEST(COALESCE(s.marketing_cooldown_until, now()), v_until),
         phone = COALESCE(EXCLUDED.phone, s.phone),
         branch_id = COALESCE(EXCLUDED.branch_id, s.branch_id);

  RETURN v_until;
END;
$$;

REVOKE ALL ON FUNCTION public.record_whatsapp_pace_event(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_whatsapp_pace_event(text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_whatsapp_pace_event(text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_pace_event(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_whatsapp_marketing_event(
  _phone text,
  _kind text,
  _branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last10 text := right(regexp_replace(COALESCE(_phone, ''), '\D', '', 'g'), 10);
BEGIN
  IF length(v_last10) < 10 OR _kind IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_recipient_state AS s (phone_last10, phone, branch_id)
  VALUES (v_last10, _phone, _branch_id)
  ON CONFLICT (phone_last10) DO UPDATE
     SET phone = COALESCE(EXCLUDED.phone, s.phone),
         branch_id = COALESCE(EXCLUDED.branch_id, s.branch_id);

  UPDATE public.whatsapp_recipient_state
     SET last_marketing_attempt_at   = CASE WHEN _kind = 'attempt'   THEN now() ELSE last_marketing_attempt_at END,
         last_marketing_delivered_at = CASE WHEN _kind = 'delivered' THEN now() ELSE last_marketing_delivered_at END,
         last_marketing_read_at      = CASE WHEN _kind = 'read'      THEN now() ELSE last_marketing_read_at END,
         last_reply_at               = CASE WHEN _kind = 'reply'     THEN now() ELSE last_reply_at END,
         marketing_cooldown_until    = CASE WHEN _kind = 'reply' THEN NULL ELSE marketing_cooldown_until END
   WHERE phone_last10 = v_last10;
END;
$$;

REVOKE ALL ON FUNCTION public.record_whatsapp_marketing_event(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_whatsapp_marketing_event(text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_whatsapp_marketing_event(text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_marketing_event(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_recipient_eligibility(
  _phones text[],
  _category text DEFAULT 'marketing'
)
RETURNS TABLE (
  phone_last10 text,
  eligible boolean,
  reason text,
  cooldown_until timestamptz,
  pace_events_30d integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT DISTINCT right(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 10) AS last10
      FROM unnest(COALESCE(_phones, ARRAY[]::text[])) AS p
  )
  SELECT
    i.last10,
    CASE
      WHEN length(i.last10) < 10 THEN false
      WHEN lower(COALESCE(_category, 'marketing')) = 'marketing'
           AND s.marketing_cooldown_until IS NOT NULL
           AND s.marketing_cooldown_until > now() THEN false
      ELSE true
    END,
    CASE
      WHEN length(i.last10) < 10 THEN 'invalid_number'
      WHEN lower(COALESCE(_category, 'marketing')) = 'marketing'
           AND s.marketing_cooldown_until IS NOT NULL
           AND s.marketing_cooldown_until > now() THEN 'pace_cooldown'
      ELSE 'eligible'
    END,
    s.marketing_cooldown_until,
    COALESCE(s.pace_events_30d, 0)
  FROM input i
  LEFT JOIN public.whatsapp_recipient_state s ON s.phone_last10 = i.last10;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_recipient_eligibility(text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_recipient_eligibility(text[], text) TO service_role;

INSERT INTO public.settings (branch_id, key, value)
SELECT NULL, 'whatsapp_marketing_cooldown_hours', to_jsonb(24)
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings WHERE key = 'whatsapp_marketing_cooldown_hours'
);