
-- Phase 2: IG Comment-to-DM hardening
ALTER TABLE public.ig_comment_campaigns
  ADD COLUMN IF NOT EXISTS daily_cap                 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_user_cooldown_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ig_media_permalink        text,
  ADD COLUMN IF NOT EXISTS public_replies_sent       integer NOT NULL DEFAULT 0;

ALTER TABLE public.ig_comment_runs
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

-- Extend counter RPC with leads + public reply counters
CREATE OR REPLACE FUNCTION public.bump_ig_campaign_counters(
  p_campaign_id     uuid,
  p_comments_matched integer DEFAULT 0,
  p_dms_sent        integer DEFAULT 0,
  p_dms_failed      integer DEFAULT 0,
  p_leads_created   integer DEFAULT 0,
  p_public_replies  integer DEFAULT 0
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ig_comment_campaigns
     SET comments_matched    = comments_matched   + COALESCE(p_comments_matched, 0),
         dms_sent            = dms_sent           + COALESCE(p_dms_sent, 0),
         dms_failed          = dms_failed         + COALESCE(p_dms_failed, 0),
         leads_created       = leads_created      + COALESCE(p_leads_created, 0),
         public_replies_sent = public_replies_sent+ COALESCE(p_public_replies, 0),
         last_triggered_at   = CASE WHEN COALESCE(p_comments_matched, 0) > 0 THEN now() ELSE last_triggered_at END,
         updated_at          = now()
   WHERE id = p_campaign_id;
$$;
