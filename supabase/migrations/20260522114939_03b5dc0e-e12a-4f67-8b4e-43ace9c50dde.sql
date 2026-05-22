
-- Phase A: SSOT for AI handles. Add per-handle ops_config + allowed_tools, trim long persona prompts into ai_knowledge.

ALTER TABLE public.ai_purposes
  ADD COLUMN IF NOT EXISTS ops_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_tools text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Migrate any system_prompt longer than 1500 chars into an ai_knowledge row
-- (topic='persona_facts'), then keep a short persona stub in ai_purposes.
DO $$
DECLARE
  r RECORD;
  stub text;
BEGIN
  FOR r IN
    SELECT id, purpose, system_prompt
    FROM public.ai_purposes
    WHERE branch_id IS NULL AND length(coalesce(system_prompt,'')) > 1500
  LOOP
    -- Skip if we've already migrated this purpose
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_knowledge
      WHERE branch_id IS NULL
        AND topic = 'persona_facts'
        AND r.purpose = ANY(applies_to)
        AND title = ('Legacy persona for ' || r.purpose)
    ) THEN
      INSERT INTO public.ai_knowledge
        (branch_id, topic, title, content, tags, applies_to, priority, is_active, status)
      VALUES
        (NULL,
         'persona_facts',
         'Legacy persona for ' || r.purpose,
         r.system_prompt,
         ARRAY['migrated','persona']::text[],
         ARRAY[r.purpose]::text[],
         50,
         true,
         'active');
    END IF;

    stub := 'You are the ' || r.purpose
         || ' handle for Incline Fitness. Voice: warm, concise, helpful, never pushy. '
         || 'Follow every rule in your knowledge base (facts, offers, behaviour, identity).';
    UPDATE public.ai_purposes SET system_prompt = stub, updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;

-- Helpful index for the per-handle knowledge lookups already used by edge fns
CREATE INDEX IF NOT EXISTS ai_knowledge_applies_to_gin
  ON public.ai_knowledge USING gin (applies_to);
