ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'dispatching'::text, 'queued'::text, 'sent'::text, 'failed'::text, 'suppressed'::text, 'skipped'::text]));