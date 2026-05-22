-- AI SSOT v1: one brain (ai_knowledge), one persona per handle (ai_purposes).
-- 1) Extend ai_knowledge so a row can be scoped to specific purposes + ordered.
ALTER TABLE public.ai_knowledge
  ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS applies_to text[] NOT NULL DEFAULT ARRAY['all']::text[],
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suggested','archived'));

CREATE INDEX IF NOT EXISTS ai_knowledge_applies_idx
  ON public.ai_knowledge USING GIN (applies_to);
CREATE INDEX IF NOT EXISTS ai_knowledge_priority_idx
  ON public.ai_knowledge (priority);

-- 2) Backfill legacy WhatsApp overlay → ai_purposes (whatsapp_reply, global).
--    Append rather than overwrite, then null the legacy field.
DO $$
DECLARE
  legacy_text text;
  cur_prompt  text;
BEGIN
  SELECT string_agg(NULLIF(trim(both FROM (whatsapp_ai_config->>'system_prompt')), ''), E'\n\n')
    INTO legacy_text
  FROM public.organization_settings
  WHERE whatsapp_ai_config ? 'system_prompt';

  IF legacy_text IS NOT NULL AND length(legacy_text) > 0 THEN
    SELECT system_prompt INTO cur_prompt
      FROM public.ai_purposes
      WHERE purpose = 'whatsapp_reply' AND branch_id IS NULL;

    IF cur_prompt IS NULL OR position(legacy_text IN cur_prompt) = 0 THEN
      UPDATE public.ai_purposes
        SET system_prompt = COALESCE(NULLIF(system_prompt,''),'')
                          || CASE WHEN COALESCE(NULLIF(system_prompt,''),'') = '' THEN '' ELSE E'\n\n' END
                          || legacy_text,
            updated_at = now()
        WHERE purpose = 'whatsapp_reply' AND branch_id IS NULL;
    END IF;
  END IF;

  -- Strip the key so future reads return nothing for it.
  UPDATE public.organization_settings
    SET whatsapp_ai_config = whatsapp_ai_config - 'system_prompt'
    WHERE whatsapp_ai_config ? 'system_prompt';
END $$;

-- 3) Backfill legacy lead nurture overlay → ai_purposes (lead_nurture, global).
DO $$
DECLARE
  legacy_text text;
  cur_prompt  text;
BEGIN
  SELECT string_agg(NULLIF(trim(both FROM (lead_nurture_config->>'nurture_prompt')), ''), E'\n\n')
    INTO legacy_text
  FROM public.organization_settings
  WHERE lead_nurture_config ? 'nurture_prompt';

  IF legacy_text IS NOT NULL AND length(legacy_text) > 0 THEN
    SELECT system_prompt INTO cur_prompt
      FROM public.ai_purposes
      WHERE purpose = 'lead_nurture' AND branch_id IS NULL;

    IF cur_prompt IS NULL OR position(legacy_text IN cur_prompt) = 0 THEN
      UPDATE public.ai_purposes
        SET system_prompt = COALESCE(NULLIF(system_prompt,''),'')
                          || CASE WHEN COALESCE(NULLIF(system_prompt,''),'') = '' THEN '' ELSE E'\n\n' END
                          || legacy_text,
            updated_at = now()
        WHERE purpose = 'lead_nurture' AND branch_id IS NULL;
    END IF;
  END IF;

  UPDATE public.organization_settings
    SET lead_nurture_config = lead_nurture_config - 'nurture_prompt'
    WHERE lead_nurture_config ? 'nurture_prompt';
END $$;

-- 4) Seed the previously-hardcoded behavioral blocks as global ai_knowledge rows
--    so both whatsapp_reply and lead_nurture handles get the same rules.
INSERT INTO public.ai_knowledge (branch_id, topic, title, content, tags, applies_to, priority, is_active, status)
VALUES
  (NULL, 'format_rules', 'Formatting & length',
   E'FORMATTING RULES:\n- Use *bold* for emphasis (e.g. *FREE* trial, *7:00 AM*, *₹2,500*).\n- Use bullet points for lists.\n- Keep replies short (1-3 sentences), warm, professional.\n- Use emojis sparingly but effectively (💪, 🔥, ✨).',
   ARRAY['format','tone'], ARRAY['all']::text[], 10, true, 'active'),
  (NULL, 'behavior_rules', 'Answer-first behavior',
   E'CRITICAL BEHAVIORAL RULES:\n- When a person asks a factual question (location, timings, fees, facilities, equipment), ALWAYS answer it directly using the GYM KNOWLEDGE.\n- Do NOT gatekeep answers behind "registration" or "sign up first".\n- After answering, you may naturally transition into collecting their details.\n- Never repeat the same question more than twice. If the user ignores a question, move on.\n- If the user sends short replies like "ok", "hmm", "yes", treat as acknowledgment and ask a NEW question.\n- For pricing, always mention plan name, duration, and price. If a day pass exists, mention it first for casual inquirers.',
   ARRAY['behavior'], ARRAY['all']::text[], 20, true, 'active'),
  (NULL, 'identity_rules', 'Member-first identity rule',
   E'ABSOLUTE IDENTITY RULE (when the contact is a confirmed active member):\n- GREET THEM BY NAME on your first reply.\n- NEVER ask for their name, email, phone, fitness goal, budget, experience, or preferred time. We already have all of this.\n- NEVER output the {"status":"lead_captured", ...} JSON. They are NOT a lead.\n- If they ask about visiting, politely note the gym is in pre-opening and share the timeline if known.\n- Use available member tools for any account question; do not guess.',
   ARRAY['identity','member'], ARRAY['whatsapp_reply']::text[], 5, true, 'active')
ON CONFLICT DO NOTHING;

-- 5) Brain health view for the self-healing dashboard card.
CREATE OR REPLACE VIEW public.ai_brain_health AS
WITH purpose_rows AS (
  SELECT p.purpose,
         p.branch_id,
         p.enabled,
         length(p.system_prompt) AS prompt_len,
         p.updated_at
    FROM public.ai_purposes p
), call_stats AS (
  SELECT purpose,
         branch_id,
         count(*) FILTER (WHERE created_at > now() - interval '24 hours')      AS calls_24h,
         count(*) FILTER (WHERE status = 'error' AND created_at > now() - interval '24 hours') AS errors_24h
    FROM public.ai_call_logs
   GROUP BY purpose, branch_id
)
SELECT pr.purpose,
       pr.branch_id,
       pr.enabled,
       pr.prompt_len,
       pr.updated_at AS purpose_updated_at,
       COALESCE(cs.calls_24h, 0)  AS calls_24h,
       COALESCE(cs.errors_24h, 0) AS errors_24h,
       CASE WHEN COALESCE(cs.calls_24h,0) > 0
            THEN round(100.0 * cs.errors_24h / cs.calls_24h, 1)
            ELSE 0 END           AS error_rate_pct,
       CASE
         WHEN pr.enabled = false           THEN 'disabled'
         WHEN pr.prompt_len < 50           THEN 'prompt_too_short'
         WHEN COALESCE(cs.calls_24h,0) > 100
              AND cs.errors_24h::numeric / NULLIF(cs.calls_24h,0) > 0.05
                                            THEN 'high_error_rate'
         ELSE 'healthy'
       END AS health_flag
  FROM purpose_rows pr
  LEFT JOIN call_stats cs USING (purpose, branch_id);

GRANT SELECT ON public.ai_brain_health TO authenticated;