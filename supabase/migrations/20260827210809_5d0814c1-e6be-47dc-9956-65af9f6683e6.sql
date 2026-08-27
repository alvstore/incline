-- ─── 1. Outbound provenance + inbound reply correlation on whatsapp_messages ───
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS communication_log_id uuid,
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS reply_to_message_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_source_type_check') THEN
    ALTER TABLE public.whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_source_type_check
      CHECK (source_type IS NULL OR source_type IN
        ('campaign','ai','human','automation','transactional','system','inbound'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_communication_log_id_fkey') THEN
    ALTER TABLE public.whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_communication_log_id_fkey
      FOREIGN KEY (communication_log_id) REFERENCES public.communication_logs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_campaign_id_fkey') THEN
    ALTER TABLE public.whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.whatsapp_messages.source_type IS
  'Provenance: campaign|ai|human|automation|transactional|system for outbound, inbound for received.';
COMMENT ON COLUMN public.whatsapp_messages.reply_to_message_id IS
  'Meta message.context.id — the provider message ID this inbound message replies to.';

CREATE INDEX IF NOT EXISTS idx_wa_messages_thread_recent
  ON public.whatsapp_messages (branch_id, phone_number, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_reply_to
  ON public.whatsapp_messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_messages_campaign
  ON public.whatsapp_messages (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_messages_comm_log
  ON public.whatsapp_messages (communication_log_id) WHERE communication_log_id IS NOT NULL;

-- ─── 2. Thread-level conversation context ───
ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS conversation_context text,
  ADD COLUMN IF NOT EXISTS context_ref_type text,
  ADD COLUMN IF NOT EXISTS context_ref_id uuid,
  ADD COLUMN IF NOT EXISTS context_set_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS context_expires_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_chat_settings_conversation_context_check') THEN
    ALTER TABLE public.whatsapp_chat_settings
      ADD CONSTRAINT whatsapp_chat_settings_conversation_context_check
      CHECK (conversation_context IS NULL OR conversation_context IN
        ('human','campaign_reply','transactional','member_support','lead','unknown'));
  END IF;
END $$;

-- ─── 3. Non-destructive backfill (only fills NULLs) ───
UPDATE public.whatsapp_messages
   SET source_type = 'inbound'
 WHERE source_type IS NULL AND direction = 'inbound';

UPDATE public.whatsapp_messages m
   SET communication_log_id = (m.media_meta ->> 'source_log_id')::uuid
 WHERE m.communication_log_id IS NULL
   AND m.direction = 'outbound'
   AND m.media_meta ? 'source_log_id'
   AND (m.media_meta ->> 'source_log_id') ~ '^[0-9a-f-]{36}$'
   AND EXISTS (SELECT 1 FROM public.communication_logs cl
                WHERE cl.id = (m.media_meta ->> 'source_log_id')::uuid);

UPDATE public.whatsapp_messages m
   SET campaign_id = c.id,
       source_type = COALESCE(m.source_type, 'campaign')
  FROM public.communication_logs cl
  JOIN public.campaigns c
    ON c.id = NULLIF(split_part(cl.dedupe_key, ':', 2), '')::uuid
 WHERE m.campaign_id IS NULL
   AND m.communication_log_id = cl.id
   AND cl.dedupe_key LIKE 'campaign:%'
   AND split_part(cl.dedupe_key, ':', 2) ~ '^[0-9a-f-]{36}$';

UPDATE public.whatsapp_messages m
   SET source_type = CASE
         WHEN cl.category IN ('payment_alert','payment_receipt','membership_reminder',
                              'invoice','transactional') THEN 'transactional'
         WHEN cl.category IN ('class_notification','reminder') THEN 'automation'
         ELSE 'system'
       END
  FROM public.communication_logs cl
 WHERE m.source_type IS NULL
   AND m.direction = 'outbound'
   AND m.communication_log_id = cl.id;

UPDATE public.whatsapp_messages
   SET source_type = CASE WHEN sent_by IS NOT NULL THEN 'human' ELSE 'system' END
 WHERE source_type IS NULL AND direction = 'outbound';