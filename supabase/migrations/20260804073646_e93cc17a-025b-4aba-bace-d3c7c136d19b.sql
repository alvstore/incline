-- 1) device_commands: allowlist + issuer binding + audit trail
CREATE OR REPLACE FUNCTION public.tg_device_commands_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_device record;
BEGIN
  IF NEW.command_type NOT IN ('relay_open','sync_users','reboot','fetch_logs','delete_user') THEN
    RAISE EXCEPTION 'Unsupported device command: %', NEW.command_type;
  END IF;

  SELECT id, branch_id, device_name INTO v_device
  FROM public.access_devices WHERE id = NEW.device_id;
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'Unknown device for command';
  END IF;

  IF v_uid IS NOT NULL THEN
    NEW.issued_by := v_uid;
  END IF;

  IF jsonb_typeof(COALESCE(NEW.payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid command payload';
  END IF;

  IF NEW.command_type = 'relay_open' THEN
    NEW.payload := jsonb_build_object(
      'duration',
      LEAST(GREATEST(COALESCE((NEW.payload->>'duration')::int, 5), 1), 15)
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, action_description, new_data, branch_id)
  VALUES (
    v_uid,
    'device_command',
    'device_commands',
    NEW.id,
    format('Issued %s on device %s', NEW.command_type, COALESCE(v_device.device_name, NEW.device_id::text)),
    jsonb_build_object('command_type', NEW.command_type, 'device_id', NEW.device_id, 'payload', NEW.payload),
    v_device.branch_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_commands_guard ON public.device_commands;
CREATE TRIGGER trg_device_commands_guard
BEFORE INSERT ON public.device_commands
FOR EACH ROW EXECUTE FUNCTION public.tg_device_commands_guard();

-- 2) howbody public report tokens must always expire
UPDATE public.howbody_public_report_tokens
   SET expires_at = COALESCE(expires_at, created_at + interval '7 days', now() + interval '7 days')
 WHERE expires_at IS NULL;

ALTER TABLE public.howbody_public_report_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
ALTER TABLE public.howbody_public_report_tokens
  ALTER COLUMN expires_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.get_howbody_public_report(_token text, _report_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tok record;
  rep jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 24 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT data_key, report_type, expires_at INTO tok
  FROM public.howbody_public_report_tokens
  WHERE token = _token
  LIMIT 1;

  IF tok IS NULL OR tok.report_type <> _report_type THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_revoked');
  END IF;

  IF tok.expires_at IS NULL OR tok.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF _report_type = 'body' THEN
    SELECT to_jsonb(r) INTO rep FROM public.howbody_body_reports r WHERE r.data_key = tok.data_key LIMIT 1;
  ELSIF _report_type = 'posture' THEN
    SELECT to_jsonb(r) INTO rep FROM public.howbody_posture_reports r WHERE r.data_key = tok.data_key LIMIT 1;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_type');
  END IF;

  IF rep IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'report', rep);
END;
$$;

-- 3) Move consent fingerprint data (IP / user agent) out of leads & profiles
INSERT INTO public.consent_events (subject_type, subject_id, action, channels, source, consent_text, ip, user_agent, created_at)
SELECT 'lead', l.id,
       CASE WHEN COALESCE(l.comm_consent_granted, false) THEN 'grant' ELSE 'revoke' END,
       COALESCE(l.comm_consent_channels, '{}'), l.comm_consent_source, l.comm_consent_text,
       l.comm_consent_ip, l.comm_consent_user_agent, COALESCE(l.comm_consent_at, now())
FROM public.leads l
WHERE (l.comm_consent_ip IS NOT NULL OR l.comm_consent_user_agent IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.consent_events ce
    WHERE ce.subject_type = 'lead' AND ce.subject_id = l.id
      AND ce.ip IS NOT DISTINCT FROM l.comm_consent_ip
      AND ce.user_agent IS NOT DISTINCT FROM l.comm_consent_user_agent
  );

INSERT INTO public.consent_events (subject_type, subject_id, action, channels, source, consent_text, ip, user_agent, created_at)
SELECT 'profile', p.id,
       CASE WHEN COALESCE(p.comm_consent_granted, false) THEN 'grant' ELSE 'revoke' END,
       COALESCE(p.comm_consent_channels, '{}'), p.comm_consent_source, p.comm_consent_text,
       p.comm_consent_ip, p.comm_consent_user_agent, COALESCE(p.comm_consent_at, now())
FROM public.profiles p
WHERE (p.comm_consent_ip IS NOT NULL OR p.comm_consent_user_agent IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.consent_events ce
    WHERE ce.subject_type = 'profile' AND ce.subject_id = p.id
      AND ce.ip IS NOT DISTINCT FROM p.comm_consent_ip
      AND ce.user_agent IS NOT DISTINCT FROM p.comm_consent_user_agent
  );

CREATE OR REPLACE FUNCTION public.record_consent(
  p_subject_type text, p_subject_id uuid, p_channels text[], p_source text,
  p_consent_text text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text,
  p_action text DEFAULT 'grant'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_granted boolean := (p_action = 'grant');
  v_now timestamptz := now();
BEGIN
  IF p_subject_type NOT IN ('lead','member','profile') THEN
    RAISE EXCEPTION 'invalid subject_type: %', p_subject_type;
  END IF;
  IF p_action NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'invalid action: %', p_action;
  END IF;

  IF p_subject_type = 'lead' THEN
    UPDATE public.leads
       SET comm_consent_granted = v_granted,
           comm_consent_at = v_now,
           comm_consent_channels = COALESCE(p_channels, '{}'),
           comm_consent_source = p_source,
           comm_consent_text = p_consent_text
     WHERE id = p_subject_id;
  ELSE
    UPDATE public.profiles
       SET comm_consent_granted = v_granted,
           comm_consent_at = v_now,
           comm_consent_channels = COALESCE(p_channels, '{}'),
           comm_consent_source = p_source,
           comm_consent_text = p_consent_text
     WHERE id = p_subject_id;
  END IF;

  INSERT INTO public.consent_events
    (subject_type, subject_id, action, channels, source, consent_text, ip, user_agent, actor_id)
  VALUES
    (p_subject_type, p_subject_id, p_action, COALESCE(p_channels,'{}'), p_source, p_consent_text, p_ip, p_user_agent, auth.uid())
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

ALTER TABLE public.leads DROP COLUMN IF EXISTS comm_consent_ip;
ALTER TABLE public.leads DROP COLUMN IF EXISTS comm_consent_user_agent;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS comm_consent_ip;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS comm_consent_user_agent;

-- 4) Government ID numbers: hidden from broad staff reads, exposed via gated RPC
REVOKE SELECT (government_id_number) ON public.profiles FROM authenticated;
REVOKE SELECT (government_id_number) ON public.profiles FROM anon;

CREATE OR REPLACE FUNCTION public.get_profile_government_id(_profile_id uuid)
RETURNS TABLE(id uuid, government_id_type text, government_id_number text, government_id_verified boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.government_id_type, p.government_id_number, p.government_id_verified
  FROM public.profiles p
  WHERE p.id = _profile_id
    AND (
      auth.uid() = p.id
      OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[])
    );
$$;

REVOKE ALL ON FUNCTION public.get_profile_government_id(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_profile_government_id(uuid) TO authenticated;