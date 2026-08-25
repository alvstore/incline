CREATE OR REPLACE FUNCTION public.fn_enqueue_failed_communication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF NEW.status NOT IN ('failed') THEN RETURN NEW; END IF;
  IF NEW.recipient IS NULL OR NEW.content IS NULL OR NEW.type IS NULL THEN RETURN NEW; END IF;

  -- Only channels the retry worker (and the queue's own constraint) support.
  IF NEW.type::text NOT IN ('email', 'sms', 'whatsapp') THEN RETURN NEW; END IF;

  -- Meta 131049 is a recipient/template pacing decision. Retrying the same
  -- payload worsens ecosystem engagement and cannot make this attempt succeed.
  IF COALESCE(NEW.error_message, '') ~* '(^|\D)131049(\D|$)|healthy ecosystem engagement' THEN
    RETURN NEW;
  END IF;

  -- Rows terminalised by the stuck-send reaper are stale by definition.
  IF COALESCE(NEW.error_message, '') ~* 'send_timeout: provider never returned' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing
  FROM public.communication_retry_queue
  WHERE original_log_id = NEW.id AND status IN ('pending','processing')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.communication_retry_queue (
    original_log_id, branch_id, type, recipient, subject, content,
    template_id, member_id, retry_count, max_retries, next_retry_at,
    last_error, status, metadata
  ) VALUES (
    NEW.id, NEW.branch_id, NEW.type, NEW.recipient, NEW.subject, NEW.content,
    NEW.template_id, NEW.member_id, 0, 3, now() + interval '5 minutes',
    NEW.error_message, 'pending',
    COALESCE(jsonb_build_object('category', NEW.category) || COALESCE(NEW.delivery_metadata, '{}'::jsonb), '{}'::jsonb)
  );
  RETURN NEW;
END;
$$;