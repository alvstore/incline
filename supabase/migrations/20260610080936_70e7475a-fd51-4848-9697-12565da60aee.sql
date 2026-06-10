
ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS bot_paused_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bot_paused_reason text NULL;

CREATE INDEX IF NOT EXISTS idx_wcs_bot_paused_until
  ON public.whatsapp_chat_settings (bot_paused_until)
  WHERE bot_paused_until IS NOT NULL;

-- Backfill: existing hard-paused chats become 24h paused so they auto-resume
UPDATE public.whatsapp_chat_settings
SET bot_paused_until = COALESCE(paused_at, now()) + interval '24 hours',
    bot_paused_reason = COALESCE(bot_paused_reason, 'legacy_backfill')
WHERE bot_active = false
  AND bot_paused_until IS NULL
  AND (do_not_contact IS DISTINCT FROM true);

CREATE OR REPLACE FUNCTION public.is_bot_paused(p_branch_id uuid, p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        (do_not_contact = true)
        OR (bot_active = false AND (bot_paused_until IS NULL OR bot_paused_until > now()))
        OR (bot_paused_until IS NOT NULL AND bot_paused_until > now())
      FROM public.whatsapp_chat_settings
      WHERE phone_number = p_phone
        AND (p_branch_id IS NULL OR branch_id = p_branch_id OR branch_id IS NULL)
      ORDER BY (branch_id = p_branch_id) DESC NULLS LAST
      LIMIT 1
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_bot_paused(uuid, text) TO authenticated, service_role, anon;
