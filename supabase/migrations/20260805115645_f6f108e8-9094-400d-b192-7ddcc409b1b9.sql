CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wamid
  ON public.whatsapp_messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_pending_outbound
  ON public.whatsapp_messages (created_at)
  WHERE direction = 'outbound' AND status = 'pending' AND whatsapp_message_id IS NULL;

ANALYZE public.whatsapp_messages;