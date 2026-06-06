-- 1) Extend enum (ADD VALUE IF NOT EXISTS must be standalone statements)
ALTER TYPE reminder_delivery_status ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE reminder_delivery_status ADD VALUE IF NOT EXISTS 'read';
ALTER TYPE reminder_delivery_status ADD VALUE IF NOT EXISTS 'replied';
ALTER TYPE reminder_delivery_status ADD VALUE IF NOT EXISTS 'bounced';
ALTER TYPE reminder_delivery_status ADD VALUE IF NOT EXISTS 'clicked';

-- 2) Add timestamp columns to communication_logs
ALTER TABLE public.communication_logs
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at      timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at   timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS bounced_at   timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_at   timestamptz;

-- 3) Idempotency index for delivery events
CREATE UNIQUE INDEX IF NOT EXISTS communication_delivery_events_log_status_uniq
  ON public.communication_delivery_events (communication_log_id, new_status)
  WHERE communication_log_id IS NOT NULL;

-- 4) Helper function — single SSOT for all channel webhooks
CREATE OR REPLACE FUNCTION public.record_delivery_event(
  p_log_id              uuid,
  p_new_status          text,
  p_provider            text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_error               text DEFAULT NULL,
  p_metadata            jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log            public.communication_logs%ROWTYPE;
  v_status         reminder_delivery_status;
  v_current_rank   int;
  v_new_rank       int;
  v_now            timestamptz := now();
  v_patch          jsonb := '{}'::jsonb;
BEGIN
  IF p_log_id IS NULL OR p_new_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing log_id or status');
  END IF;

  -- Validate enum value early
  BEGIN
    v_status := p_new_status::reminder_delivery_status;
  EXCEPTION WHEN invalid_text_representation OR others THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_status', 'status', p_new_status);
  END;

  SELECT * INTO v_log FROM public.communication_logs WHERE id = p_log_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'log_not_found');
  END IF;

  -- Stage rank: higher = further along the rail
  v_current_rank := CASE v_log.delivery_status::text
    WHEN 'scheduled'  THEN 0
    WHEN 'queued'     THEN 1
    WHEN 'sending'    THEN 2
    WHEN 'sent'       THEN 3
    WHEN 'delivered'  THEN 4
    WHEN 'read'       THEN 5
    WHEN 'clicked'    THEN 5
    WHEN 'replied'    THEN 6
    WHEN 'failed'     THEN 99
    WHEN 'bounced'    THEN 99
    WHEN 'suppressed' THEN 99
    WHEN 'deduped'    THEN 99
    WHEN 'skipped'    THEN 99
    ELSE 0
  END;
  v_new_rank := CASE p_new_status
    WHEN 'scheduled'  THEN 0
    WHEN 'queued'     THEN 1
    WHEN 'sending'    THEN 2
    WHEN 'sent'       THEN 3
    WHEN 'delivered'  THEN 4
    WHEN 'read'       THEN 5
    WHEN 'clicked'    THEN 5
    WHEN 'replied'    THEN 6
    WHEN 'failed'     THEN 99
    WHEN 'bounced'    THEN 99
    ELSE 0
  END;

  -- Insert delivery event (idempotent on log + status)
  INSERT INTO public.communication_delivery_events (
    branch_id, communication_log_id, member_id, channel,
    previous_status, new_status, provider, provider_message_id,
    error_message, metadata
  )
  VALUES (
    v_log.branch_id, v_log.id, v_log.member_id,
    COALESCE(v_log.channel, v_log.type, 'unknown'),
    v_log.delivery_status, v_status,
    p_provider, p_provider_message_id, p_error,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (communication_log_id, new_status) DO NOTHING;

  -- Build patch: timestamps + metadata always; status only when advancing
  v_patch := jsonb_build_object(
    'delivery_metadata',
    COALESCE(v_log.delivery_metadata, '{}'::jsonb)
      || COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('last_event_at', v_now, 'last_event_status', p_new_status)
  );

  IF p_new_status = 'delivered' AND v_log.delivered_at IS NULL THEN
    v_patch := v_patch || jsonb_build_object('delivered_at', v_now);
  ELSIF p_new_status = 'read' AND v_log.read_at IS NULL THEN
    v_patch := v_patch || jsonb_build_object('read_at', v_now);
  ELSIF p_new_status = 'replied' AND v_log.replied_at IS NULL THEN
    v_patch := v_patch || jsonb_build_object('replied_at', v_now);
  ELSIF p_new_status = 'failed' AND v_log.failed_at IS NULL THEN
    v_patch := v_patch || jsonb_build_object('failed_at', v_now);
  ELSIF p_new_status = 'bounced' AND v_log.bounced_at IS NULL THEN
    v_patch := v_patch || jsonb_build_object('bounced_at', v_now);
  ELSIF p_new_status = 'clicked' AND v_log.clicked_at IS NULL THEN
    v_patch := v_patch || jsonb_build_object('clicked_at', v_now);
  END IF;

  -- Only advance enum forward; failure/bounce always wins over earlier in-flight stages
  IF v_new_rank > v_current_rank OR
     (p_new_status IN ('failed','bounced') AND v_log.delivery_status::text NOT IN ('delivered','read','replied','clicked')) THEN
    v_patch := v_patch || jsonb_build_object('delivery_status', p_new_status);
    IF p_error IS NOT NULL THEN
      v_patch := v_patch || jsonb_build_object('error_message', p_error);
    END IF;
  END IF;

  UPDATE public.communication_logs
     SET delivery_metadata = (v_patch->'delivery_metadata')::jsonb,
         delivery_status   = COALESCE((v_patch->>'delivery_status')::reminder_delivery_status, delivery_status),
         delivered_at      = COALESCE((v_patch->>'delivered_at')::timestamptz, delivered_at),
         read_at           = COALESCE((v_patch->>'read_at')::timestamptz, read_at),
         replied_at        = COALESCE((v_patch->>'replied_at')::timestamptz, replied_at),
         failed_at         = COALESCE((v_patch->>'failed_at')::timestamptz, failed_at),
         bounced_at        = COALESCE((v_patch->>'bounced_at')::timestamptz, bounced_at),
         clicked_at        = COALESCE((v_patch->>'clicked_at')::timestamptz, clicked_at),
         error_message     = COALESCE(v_patch->>'error_message', error_message)
   WHERE id = p_log_id;

  RETURN jsonb_build_object('ok', true, 'advanced', v_new_rank > v_current_rank, 'status', p_new_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_delivery_event(uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_delivery_event(uuid, text, text, text, text, jsonb) TO authenticated;