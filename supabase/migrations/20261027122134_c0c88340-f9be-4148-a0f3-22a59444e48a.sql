UPDATE public.whatsapp_triggers
   SET template_id = '5040f9fa-7640-4b0d-965f-7f0a82c3bd13'
 WHERE id = '93dd48c2-e4a0-4f2f-9def-a9e721895529'
   AND event_name = 'retention_stage_2';

UPDATE public.whatsapp_recipient_state
   SET marketing_cooldown_until = NULL
 WHERE phone_last10 IN ('9887601200','9928910901');