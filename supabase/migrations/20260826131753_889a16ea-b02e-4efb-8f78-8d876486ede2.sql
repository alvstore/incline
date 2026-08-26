CREATE OR REPLACE FUNCTION public.record_delivery_event(
  p_log_id uuid,
  p_new_status text,
  p_provider text DEFAULT NULL::text,
  p_provider_message_id text DEFAULT NULL::text,
  p_error text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log            public.communication_logs%ROWTYPE;
  v_status         reminder_delivery_status;
  v_current_rank   int;
  v_new_rank       int;
  v_now            timestamptz := now();
  v_patch          jsonb := '{}'::jsonb;
  v_advanced       boolean := false;
  v_parts          text[];
  v_campaign_id    uuid;
  v_recipient_id   uuid;
  v_rec_status     text;
BEGIN
  IF p_log_id IS NULL OR p_new_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing log_id or status');
  END IF;

  BEGIN
    v_status := p_new_status::reminder_delivery_status;
  EXCEPTION WHEN invalid_text_representation OR others THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_status', 'status', p_new_status);
  END;

  SELECT * INTO v_log FROM public.communication_logs WHERE id = p_log_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'log_not_found');
  END IF;

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

  IF v_new_rank > v_current_rank OR
     (p_new_status IN ('failed','bounced') AND v_log.delivery_status::text NOT IN ('delivered','read','replied','clicked')) THEN
    v_advanced := true;
    v_patch := v_patch || jsonb_build_object('delivery_status', p_new_status);
    IF p_error IS NOT NULL THEN
      v_patch := v_patch || jsonb_build_object('error_message', p_error);
    END IF;
  END IF;

  UPDATE public.communication_logs
     SET delivery_metadata = (v_patch->'delivery_metadata')::jsonb,
         delivery_status   = COALESCE((v_patch->>'delivery_status')::reminder_delivery_status, delivery_status),
         status            = COALESCE(v_patch->>'delivery_status', status),
         delivered_at      = COALESCE((v_patch->>'delivered_at')::timestamptz, delivered_at),
         read_at           = COALESCE((v_patch->>'read_at')::timestamptz, read_at),
         replied_at        = COALESCE((v_patch->>'replied_at')::timestamptz, replied_at),
         failed_at         = COALESCE((v_patch->>'failed_at')::timestamptz, failed_at),
         bounced_at        = COALESCE((v_patch->>'bounced_at')::timestamptz, bounced_at),
         clicked_at        = COALESCE((v_patch->>'clicked_at')::timestamptz, clicked_at),
         provider_message_id = COALESCE(provider_message_id, p_provider_message_id),
         error_message     = COALESCE(v_patch->>'error_message', error_message)
   WHERE id = p_log_id;

  -- ── Propagate the authoritative provider outcome to the campaign recipient.
  -- Dedupe keys look like `campaign:<uuid>:<source_type>:<source_ref_id>[:variant…]`.
  IF v_log.dedupe_key IS NOT NULL AND v_log.dedupe_key LIKE 'campaign:%' THEN
    v_parts := string_to_array(v_log.dedupe_key, ':');
    IF array_length(v_parts, 1) >= 4 THEN
      BEGIN
        v_campaign_id := v_parts[2]::uuid;
        SELECT id INTO v_recipient_id
        FROM public.campaign_recipients
        WHERE campaign_id = v_campaign_id
          AND source_type = v_parts[3]
          AND source_ref_id::text = v_parts[4]
          AND superseded = false
        LIMIT 1;
      EXCEPTION WHEN others THEN
        v_recipient_id := NULL;
      END;

      IF v_recipient_id IS NOT NULL THEN
        v_rec_status := CASE p_new_status
          WHEN 'delivered' THEN 'delivered'
          WHEN 'read'      THEN 'read'
          WHEN 'sent'      THEN 'sent'
          WHEN 'queued'    THEN 'queued'
          WHEN 'failed'    THEN 'failed'
          WHEN 'bounced'   THEN 'failed'
          WHEN 'suppressed' THEN 'suppressed'
          WHEN 'skipped'   THEN 'skipped'
          ELSE NULL END;
        IF v_rec_status IS NOT NULL THEN
          PERFORM public.apply_campaign_recipient_status(
            v_recipient_id, v_rec_status, p_error, NULL,
            substring(COALESCE(p_error,'') from '\m(13\d{4})\M'),
            p_provider_message_id, NULL, p_log_id, NULL
          );
          PERFORM public.refresh_campaign_stats(v_campaign_id);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'advanced', v_advanced, 'status', p_new_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_campaign_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_stats(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.campaign_recipient_rank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_recipient_rank(text) TO service_role;