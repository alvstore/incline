-- AI Training: enhance ai_dynamic_memory + add suggestions table + founder handoff dedupe
ALTER TABLE public.ai_dynamic_memory
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'any' CHECK (language IN ('en','hi','hinglish','any')),
  ADD COLUMN IF NOT EXISTS examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'admin' CHECK (created_via IN ('admin','seed','ai_suggested'));

CREATE INDEX IF NOT EXISTS idx_ai_dynamic_memory_last_matched
  ON public.ai_dynamic_memory(last_matched_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.bump_dynamic_memory_hit(_rule_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ai_dynamic_memory
     SET match_count = match_count + 1,
         last_matched_at = now()
   WHERE id = _rule_id;
$$;
GRANT EXECUTE ON FUNCTION public.bump_dynamic_memory_hit(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.ai_dynamic_memory_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase text NOT NULL,
  suggested_intent text NOT NULL CHECK (suggested_intent IN ('location','pricing','timeline','handoff','decline','name_block','custom')),
  sample_message text,
  source_conversation_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','promoted','dismissed')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_dynamic_memory_suggestions TO authenticated;
GRANT ALL ON public.ai_dynamic_memory_suggestions TO service_role;

ALTER TABLE public.ai_dynamic_memory_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read suggestions" ON public.ai_dynamic_memory_suggestions;
DROP POLICY IF EXISTS "auth write suggestions" ON public.ai_dynamic_memory_suggestions;
DROP POLICY IF EXISTS "auth update suggestions" ON public.ai_dynamic_memory_suggestions;
DROP POLICY IF EXISTS "auth delete suggestions" ON public.ai_dynamic_memory_suggestions;

CREATE POLICY "auth read suggestions"   ON public.ai_dynamic_memory_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write suggestions"  ON public.ai_dynamic_memory_suggestions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update suggestions" ON public.ai_dynamic_memory_suggestions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete suggestions" ON public.ai_dynamic_memory_suggestions FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ai_dyn_mem_suggestions_status
  ON public.ai_dynamic_memory_suggestions(status, created_at DESC);

ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS founder_handoff_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_chat_founder_handoff
  ON public.whatsapp_chat_settings(founder_handoff_task_id)
  WHERE founder_handoff_task_id IS NOT NULL;

-- Server-mirrored capability for delete_task (RBAC parity). role column is app_role enum.
INSERT INTO public.role_capabilities(role, capability)
SELECT r::public.app_role, 'delete_task'
FROM unnest(ARRAY['owner','admin','manager']) AS r
ON CONFLICT DO NOTHING;