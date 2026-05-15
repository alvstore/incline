
-- AI single source of truth: purposes, knowledge, memory

-- 1. ai_purposes — one row per (branch, purpose). NULL branch = global default.
CREATE TABLE IF NOT EXISTS public.ai_purposes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  provider_id uuid NULL REFERENCES public.ai_provider_configs(id) ON DELETE SET NULL,
  model text NULL,
  system_prompt text NOT NULL DEFAULT '',
  temperature numeric NULL,
  max_tokens int NULL,
  reply_delay_seconds int NOT NULL DEFAULT 0,
  tools_allowed text[] NOT NULL DEFAULT '{}',
  guards jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_purposes_unique_branch_purpose
  ON public.ai_purposes (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose);

CREATE INDEX IF NOT EXISTS ai_purposes_branch_idx ON public.ai_purposes(branch_id);
CREATE INDEX IF NOT EXISTS ai_purposes_purpose_idx ON public.ai_purposes(purpose);

CREATE TRIGGER trg_ai_purposes_updated_at
BEFORE UPDATE ON public.ai_purposes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_purposes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_purposes_select_staff"
ON public.ai_purposes FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE POLICY "ai_purposes_write_admin"
ON public.ai_purposes FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR (public.has_role(auth.uid(), 'manager') AND branch_id IS NOT NULL)
)
WITH CHECK (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR (public.has_role(auth.uid(), 'manager') AND branch_id IS NOT NULL)
);

-- 2. ai_knowledge — gym facts/FAQs/tone, injected into prompts by topic
CREATE TABLE IF NOT EXISTS public.ai_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  topic text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_branch_topic_idx ON public.ai_knowledge(branch_id, topic) WHERE is_active;

CREATE TRIGGER trg_ai_knowledge_updated_at
BEFORE UPDATE ON public.ai_knowledge
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_knowledge_select_staff"
ON public.ai_knowledge FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE POLICY "ai_knowledge_write_admin"
ON public.ai_knowledge FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
)
WITH CHECK (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
);

-- 3. ai_memory — per-contact long-term memory (intent, profile, facts)
CREATE TABLE IF NOT EXISTS public.ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  contact_key text NOT NULL,
  platform text NOT NULL DEFAULT 'whatsapp',
  current_intent text NULL,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  asked_questions text[] NOT NULL DEFAULT '{}',
  do_not_ask text[] NOT NULL DEFAULT '{}',
  summary text NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_memory_unique_contact
  ON public.ai_memory (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), platform, contact_key);

CREATE TRIGGER trg_ai_memory_updated_at
BEFORE UPDATE ON public.ai_memory
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_memory_select_staff"
ON public.ai_memory FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE POLICY "ai_memory_write_admin"
ON public.ai_memory FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
)
WITH CHECK (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
);

-- 4. Seed global purposes from current hard-coded prompts.
-- Each row is the GLOBAL default (branch_id IS NULL). Branches inherit unless overridden.
INSERT INTO public.ai_purposes (branch_id, purpose, enabled, model, system_prompt, description, tools_allowed, guards, extra)
VALUES
  (NULL, 'whatsapp_reply', true, 'google/gemini-3-flash-preview',
   E'You are a helpful gym assistant for "Incline Fitness". Answer questions about membership, timings, and facilities. Keep responses short, warm, and professional. Use *bold* for emphasis (₹2,500, 7:00 AM). Use bullets for lists. Use emojis sparingly (💪 🔥 ✨).',
   'WhatsApp / Instagram / Messenger conversational reply brain',
   ARRAY['get_membership_status','get_member_benefits','get_member_bookings','get_pt_sessions','get_invoices','book_facility_slot','transfer_to_human']::text[],
   '{"non_fitness_redirect": true, "interactive_blocks": true, "lead_capture_after_question": true}'::jsonb,
   '{"lead_capture": {"enabled": true, "target_fields": ["name","email","goal","plan_interest"], "handoff_message": "Thanks for sharing! Our team will reach out to you shortly. 💪"}}'::jsonb),

  (NULL, 'lead_nurture', true, 'google/gemini-3-flash-preview',
   E'You are a friendly gym assistant for Incline Fitness. Write a single short WhatsApp follow-up message (max 2 sentences) to re-engage a lead who stopped responding. Be warm, specific to their interest, and end with a soft CTA.',
   'Re-engagement nudge for cold leads (lead-nurture-followup)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'lead_score', true, 'google/gemini-3-flash-preview',
   E'You are a sales qualification assistant. Score a gym lead from 1-100 based on intent strength, fit, and conversation engagement. Return ONLY structured JSON.',
   'Lead scoring (score-leads)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'campaign_draft', true, 'google/gemini-3-flash-preview',
   E'You are a marketing copywriter for Incline Fitness. Draft engaging campaign messages (WhatsApp/Email/SMS) that match the requested tone, include the event details verbatim, and end with a clear CTA. Avoid emojis in the email subject line.',
   'AI-drafted marketing/campaign messages (ai-draft-campaign-message)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'template_generate', true, 'google/gemini-3-flash-preview',
   E'You are an expert in WhatsApp Business templates. Generate Meta-compliant template bodies with proper variable placeholders {{1}}, {{2}}. Document events MUST use header_type=none and {{document_link}} body var.',
   'WhatsApp template auto-generation (ai-generate-whatsapp-templates)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'dashboard_insight', true, 'google/gemini-3-flash-preview',
   E'You are a gym operations analyst. Read the dashboard metrics and produce 3-5 short, actionable insights for the owner. Each insight = one sentence, optional metric, one suggested action.',
   'Owner dashboard insights (ai-dashboard-insights)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'fitness_plan', true, 'google/gemini-3-flash-preview',
   E'You are a certified fitness coach. Generate a personalized workout or diet plan based on the member''s goal, experience, and constraints. Use clear headings and structured days/meals.',
   'AI-generated workout/diet plans (generate-fitness-plan)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'review_reply', true, 'google/gemini-3-flash-preview',
   E'You are the customer experience voice of Incline Fitness. Reply to Google reviews briefly (≤3 sentences), thank by name, address specific points, and avoid generic responses. For low ratings, apologize and invite them to email info@theinclinelife.com.',
   'Google review auto-reply (google-reviews-brain)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb),

  (NULL, 'automation_rule', true, 'google/gemini-3-flash-preview',
   E'You are an automation engine that drafts the message bodies for triggered automation rules (birthday wishes, expiry reminders, etc.). Match the configured tone and keep messages short.',
   'Per-rule message generation (automation-brain)',
   '{}'::text[], '{}'::jsonb, '{}'::jsonb)

ON CONFLICT (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose) DO NOTHING;

-- 5. Resolver helper: fetch effective config for (purpose, branch) with fallback to global.
CREATE OR REPLACE FUNCTION public.get_ai_purpose(_purpose text, _branch_id uuid DEFAULT NULL)
RETURNS public.ai_purposes
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.ai_purposes
  WHERE purpose = _purpose
    AND (branch_id = _branch_id OR (_branch_id IS NULL AND branch_id IS NULL))
  UNION ALL
  SELECT * FROM public.ai_purposes
  WHERE purpose = _purpose AND branch_id IS NULL
  ORDER BY branch_id NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_purpose(text, uuid) TO authenticated, service_role;
