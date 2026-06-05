-- Instagram/Messenger AI reply idempotency + outbound dedupe hardening

-- 1) Per-contact AI claim table — prevents the brain from replying twice in a burst
CREATE TABLE IF NOT EXISTS public.meta_ai_reply_claims (
  branch_id uuid NOT NULL,
  platform text NOT NULL,
  phone_number text NOT NULL,
  bucket bigint NOT NULL,
  inbound_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, platform, phone_number, bucket)
);

GRANT SELECT, INSERT, DELETE ON public.meta_ai_reply_claims TO service_role;
ALTER TABLE public.meta_ai_reply_claims ENABLE ROW LEVEL SECURITY;
-- service_role bypasses RLS; no policies needed (edge functions only).

CREATE INDEX IF NOT EXISTS meta_ai_reply_claims_created_idx
  ON public.meta_ai_reply_claims (created_at);

-- 2) Atomic claim RPC. Returns TRUE only for the first caller in the bucket window.
CREATE OR REPLACE FUNCTION public.claim_meta_ai_reply(
  p_branch_id uuid,
  p_platform text,
  p_phone text,
  p_window_seconds int DEFAULT 45,
  p_inbound_message_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket bigint;
  v_inserted int;
BEGIN
  v_bucket := floor(extract(epoch FROM now()) / GREATEST(p_window_seconds, 5))::bigint;
  INSERT INTO public.meta_ai_reply_claims (branch_id, platform, phone_number, bucket, inbound_message_id)
  VALUES (p_branch_id, p_platform, p_phone, v_bucket, p_inbound_message_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- Best-effort GC: drop claims older than 1 day
  DELETE FROM public.meta_ai_reply_claims WHERE created_at < now() - interval '1 day';
  RETURN v_inserted > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_meta_ai_reply(uuid, text, text, int, uuid) TO service_role;

-- 3) Hard guard against duplicate platform_message_id rows (Meta echoes)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_platform_msgid_uniq
  ON public.whatsapp_messages (platform, platform_message_id)
  WHERE platform_message_id IS NOT NULL;