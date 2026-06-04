ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS comm_consent_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comm_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS comm_consent_channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS comm_consent_source text,
  ADD COLUMN IF NOT EXISTS comm_consent_ip inet,
  ADD COLUMN IF NOT EXISTS comm_consent_user_agent text,
  ADD COLUMN IF NOT EXISTS comm_consent_text text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS comm_consent_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comm_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS comm_consent_channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS comm_consent_source text,
  ADD COLUMN IF NOT EXISTS comm_consent_ip inet,
  ADD COLUMN IF NOT EXISTS comm_consent_user_agent text,
  ADD COLUMN IF NOT EXISTS comm_consent_text text;

CREATE TABLE IF NOT EXISTS public.consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('lead','member','profile')),
  subject_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  channels text[] NOT NULL DEFAULT '{}',
  source text,
  consent_text text,
  ip inet,
  user_agent text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_events_subject
  ON public.consent_events(subject_type, subject_id, created_at DESC);

GRANT SELECT ON public.consent_events TO authenticated;
GRANT ALL ON public.consent_events TO service_role;

ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners admins managers can read consent events" ON public.consent_events;
CREATE POLICY "Owners admins managers can read consent events"
  ON public.consent_events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
  );

CREATE OR REPLACE FUNCTION public.record_consent(
  p_subject_type text,
  p_subject_id uuid,
  p_channels text[],
  p_source text,
  p_consent_text text,
  p_ip inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_action text DEFAULT 'grant'
)
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
       SET comm_consent_granted   = v_granted,
           comm_consent_at        = v_now,
           comm_consent_channels  = COALESCE(p_channels, '{}'),
           comm_consent_source    = p_source,
           comm_consent_ip        = p_ip,
           comm_consent_user_agent= p_user_agent,
           comm_consent_text      = p_consent_text
     WHERE id = p_subject_id;
  ELSE
    UPDATE public.profiles
       SET comm_consent_granted   = v_granted,
           comm_consent_at        = v_now,
           comm_consent_channels  = COALESCE(p_channels, '{}'),
           comm_consent_source    = p_source,
           comm_consent_ip        = p_ip,
           comm_consent_user_agent= p_user_agent,
           comm_consent_text      = p_consent_text
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

GRANT EXECUTE ON FUNCTION public.record_consent(text, uuid, text[], text, text, inet, text, text)
  TO authenticated, service_role;

ALTER TABLE public.member_communication_preferences
  ADD COLUMN IF NOT EXISTS rcs_enabled boolean NOT NULL DEFAULT false;