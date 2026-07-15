-- Add provider_route to campaign_recipients so the Campaign Detail drawer
-- can show whether each recipient was sent via WhatsApp Cloud API or
-- Marketing Messages API (MM API) for WhatsApp.
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS provider_route text;

COMMENT ON COLUMN public.campaign_recipients.provider_route IS
  'Which WhatsApp send route delivered this recipient: cloud_api | mm_api | rcs | sms | email | null.';

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_provider_route
  ON public.campaign_recipients(campaign_id, provider_route);