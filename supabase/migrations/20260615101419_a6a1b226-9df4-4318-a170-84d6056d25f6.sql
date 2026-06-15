
CREATE TABLE public.ai_dynamic_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase_or_pattern text NOT NULL,
  intent_category text NOT NULL CHECK (intent_category IN ('location','pricing','timeline','handoff','decline','name_block','custom')),
  correction_instruction text NOT NULL,
  match_type text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('exact','contains','regex')),
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_dynamic_memory_phrase_uniq
  ON public.ai_dynamic_memory (lower(phrase_or_pattern), match_type);

CREATE INDEX ai_dynamic_memory_active_priority_idx
  ON public.ai_dynamic_memory (is_active, priority DESC)
  WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_dynamic_memory TO authenticated;
GRANT ALL ON public.ai_dynamic_memory TO service_role;

ALTER TABLE public.ai_dynamic_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_dynamic_memory_select_authenticated"
  ON public.ai_dynamic_memory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "ai_dynamic_memory_admin_write"
  ON public.ai_dynamic_memory FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER ai_dynamic_memory_set_updated_at
  BEFORE UPDATE ON public.ai_dynamic_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ai_dynamic_memory (phrase_or_pattern, intent_category, correction_instruction, match_type, priority) VALUES
  ('kha pr h',   'location', 'User is asking for the gym location. Answer: Sector 14, Udaipur, Rajasthan. Then politely re-ask for the missing detail. Do NOT save this as a name.', 'contains', 200),
  ('kaha',       'location', 'User is asking for the gym location. Answer: Sector 14, Udaipur, Rajasthan. Then re-ask for the missing detail. Do NOT save as name.', 'contains', 190),
  ('kidhar',     'location', 'Location question. Answer: Sector 14, Udaipur, Rajasthan. Then re-ask. Do NOT save as name.', 'contains', 180),
  ('kitna',      'pricing',  'Pricing question. Apply Founder''s Embargo — do NOT quote ₹, fees, or package counts. Offer Founding Member team handoff. Do NOT save as name.', 'contains', 200),
  ('fees',       'pricing',  'Pricing question. Apply Founder''s Embargo — no prices. Offer Founding Member team handoff. Do NOT save as name.', 'contains', 190),
  ('kab khulega','timeline', 'Launch question. Answer: We open on June 22, 2026. Founding Members get launch-day perks. Then re-ask for the missing detail. Do NOT save as name.', 'contains', 200),
  ('human',      'handoff',  'User wants a human agent. Pause AI for 24h, mark handoff, notify staff. Do NOT continue the capture funnel.', 'contains', 250),
  ('agent',      'handoff',  'User wants a human agent. Pause AI for 24h, mark handoff, notify staff. Do NOT continue the capture funnel.', 'contains', 250),
  ('nahi',       'decline',  'User declined. Honor opt-out — do not save as name, do not push further questions in this turn.', 'exact', 220);
