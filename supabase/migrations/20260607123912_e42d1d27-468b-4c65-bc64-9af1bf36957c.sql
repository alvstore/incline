-- Repair: lead_created trigger was pointed at internal_lead_alert,
-- which Meta only approved in en_GB while the dispatcher sends en → 132001.
-- prospect_welcome_greet is approved in 'en' and is the natural lead-welcome message.

DO $$
DECLARE
  v_new_template_id uuid;
BEGIN
  SELECT id INTO v_new_template_id
  FROM public.templates
  WHERE name = 'prospect_welcome_greet'
    AND type = 'whatsapp'
    AND is_active = true
    AND meta_template_status = 'APPROVED'
  LIMIT 1;

  IF v_new_template_id IS NULL THEN
    RAISE EXCEPTION 'Replacement template prospect_welcome_greet not found / not APPROVED';
  END IF;

  UPDATE public.whatsapp_triggers
     SET template_id = v_new_template_id,
         updated_at  = now()
   WHERE template_id = 'f54f2c23-7abc-488b-9359-ce3de58250f6'
     AND event_name = 'lead_created';

  UPDATE public.communication_retry_queue
     SET status = 'cancelled'
   WHERE template_id = 'f54f2c23-7abc-488b-9359-ce3de58250f6'
     AND status NOT IN ('cancelled','sent','exhausted');
END $$;