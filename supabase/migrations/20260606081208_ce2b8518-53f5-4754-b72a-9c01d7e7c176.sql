-- Backfill ai_memory.contact_key for Instagram/Messenger so it matches the
-- E.164-ish format ('+<digits>') that whatsapp_messages.phone_number and
-- whatsapp_chat_settings.phone_number are normalized to by trigger
-- normalize_phone_in. Without this alignment, the AI brain's per-contact
-- history queries miss and the model thinks every turn is the first one.
UPDATE public.ai_memory
   SET contact_key = '+' || contact_key
 WHERE platform IN ('instagram','messenger')
   AND contact_key ~ '^[0-9]+$'
   AND NOT EXISTS (
     SELECT 1 FROM public.ai_memory existing
      WHERE existing.platform = ai_memory.platform
        AND existing.contact_key = '+' || ai_memory.contact_key
        AND COALESCE(existing.branch_id, '00000000-0000-0000-0000-000000000000')
            = COALESCE(ai_memory.branch_id, '00000000-0000-0000-0000-000000000000')
   );

-- Mark IG/Messenger outbound rows stuck on the "pending" clock for >10 min
-- as failed so the inbox surfaces a clear state. New self-heal path in
-- meta-webhook v5.4.0 prevents future stuck rows.
UPDATE public.whatsapp_messages
   SET status = 'failed',
       failure_reason = COALESCE(failure_reason, 'stuck_pending_meta_outbound_autofix_v540'),
       failed_at = COALESCE(failed_at, now())
 WHERE platform IN ('instagram','messenger')
   AND direction = 'outbound'
   AND status = 'pending'
   AND created_at < now() - interval '10 minutes';