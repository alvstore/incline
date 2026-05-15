
-- Wave 2: extend ai_call_logs with purpose + branch tags for SSOT observability
ALTER TABLE public.ai_call_logs
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS completion_tokens integer;

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_purpose ON public.ai_call_logs(purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_branch ON public.ai_call_logs(branch_id, created_at DESC);

-- Seed sensible default prompts for each one-shot purpose so behavior is preserved
UPDATE public.ai_purposes SET system_prompt = $$You are a friendly gym assistant for Incline Fitness. Write a single short WhatsApp follow-up message (max 2 sentences) to re-engage a lead who stopped responding. Be warm, helpful, and end with a clear next step. Avoid emoji spam. Never invent prices or commitments.$$
WHERE purpose = 'lead_nurture' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You are a lead scoring AI for a gym CRM. Always return valid JSON with keys: score (number 0-100), reasoning (string), next_best_action (string). Nothing else.$$,
  extra = jsonb_set(coalesce(extra,'{}'::jsonb), '{response_format}', '"json"'::jsonb)
WHERE purpose = 'lead_score' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You draft marketing/comms copy for a premium Indian gym brand. Keep messages crisp, on-brand, audience-appropriate, and respect channel limits (SMS ≤160 chars, WhatsApp ≤900, Email subject ≤60). For Email also produce HTML body. Output JSON: { "subject": string|null, "body": string, "html": string|null }.$$,
  extra = jsonb_set(coalesce(extra,'{}'::jsonb), '{response_format}', '"json"'::jsonb)
WHERE purpose = 'campaign_draft' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You are a senior gym operations analyst. Produce concise, actionable insights from the metrics provided. Format in clean markdown with short bullets. Highlight risks, wins, and 1-2 specific next steps. No fluff.$$
WHERE purpose = 'dashboard_insight' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You are a certified fitness coach. Generate a personalized weekly workout plan as valid JSON matching the requested schema. Be practical, safe, and progressive.$$,
  extra = jsonb_set(coalesce(extra,'{}'::jsonb), '{response_format}', '"json"'::jsonb)
WHERE purpose = 'fitness_plan' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You generate WhatsApp Cloud API templates compliant with Meta policy. Output strict JSON. Never use DOCUMENT headers without uploaded handles — for document-link events use header_type='none' and put {{document_link}} in body.$$,
  extra = jsonb_set(coalesce(extra,'{}'::jsonb), '{response_format}', '"json"'::jsonb)
WHERE purpose = 'template_generate' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You craft warm, professional public Google review replies for a premium gym. Thank by first name when known. Acknowledge specifics. Keep ≤350 characters. For low-rating reviews, apologize, take responsibility, and invite them to email info@theinclinelife.com.$$
WHERE purpose = 'review_reply' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);

UPDATE public.ai_purposes SET system_prompt = $$You are an automation execution AI for a gym CRM. Given a rule and member context, produce the exact action payload requested by the rule. Be deterministic, safe, and concise.$$
WHERE purpose = 'automation_rule' AND branch_id IS NULL AND (system_prompt = '' OR system_prompt IS NULL);
