
ALTER TABLE public.ai_call_logs
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS contact_key text;

ALTER TABLE public.ai_tool_logs
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS contact_key text;

UPDATE public.ai_call_logs
   SET platform = 'whatsapp'
 WHERE platform IS NULL
   AND purpose IN ('whatsapp_reply','context_extract');

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_platform_created ON public.ai_call_logs(platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_logs_platform_created ON public.ai_tool_logs(platform, created_at DESC);
