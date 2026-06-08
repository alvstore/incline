
-- 1. Angles catalogue
CREATE TABLE public.lead_nurture_angles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  label text NOT NULL,
  tone text NOT NULL,
  prompt_hint text NOT NULL,
  fallback_template text NOT NULL,
  weight int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, slug)
);

GRANT SELECT ON public.lead_nurture_angles TO authenticated;
GRANT ALL ON public.lead_nurture_angles TO service_role;
ALTER TABLE public.lead_nurture_angles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff+ can read nurture angles" ON public.lead_nurture_angles
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role]));

CREATE POLICY "Owners/admins manage nurture angles" ON public.lead_nurture_angles
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));

CREATE TRIGGER update_lead_nurture_angles_updated_at
  BEFORE UPDATE ON public.lead_nurture_angles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Per-chat tracking columns
ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS nurture_angle_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_nurture_text text NULL,
  ADD COLUMN IF NOT EXISTS last_nurture_hash text NULL;

-- 3. Angle picker
CREATE OR REPLACE FUNCTION public.pick_next_nurture_angle(_chat_id uuid)
RETURNS TABLE(slug text, label text, tone text, prompt_hint text, fallback_template text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _branch uuid;
  _history jsonb;
  _recent text[];
BEGIN
  SELECT s.branch_id, COALESCE(s.nurture_angle_history, '[]'::jsonb)
    INTO _branch, _history
  FROM whatsapp_chat_settings s WHERE s.id = _chat_id;

  -- last 3 slugs used
  SELECT COALESCE(array_agg(value->>'slug' ORDER BY ord DESC), ARRAY[]::text[])
    INTO _recent
  FROM (
    SELECT value, row_number() OVER () AS ord
    FROM jsonb_array_elements(_history) WITH ORDINALITY t(value, ord)
    ORDER BY ord DESC
    LIMIT 3
  ) recent;

  RETURN QUERY
  WITH candidates AS (
    SELECT a.*,
           (a.weight::float * random()) AS score
    FROM lead_nurture_angles a
    WHERE a.is_active
      AND (a.branch_id IS NULL OR a.branch_id = _branch)
      AND NOT (a.slug = ANY (_recent))
  ),
  fallback AS (
    SELECT a.*, (a.weight::float * random()) AS score
    FROM lead_nurture_angles a
    WHERE a.is_active
      AND (a.branch_id IS NULL OR a.branch_id = _branch)
  )
  SELECT c.slug, c.label, c.tone, c.prompt_hint, c.fallback_template
  FROM (
    SELECT * FROM candidates
    UNION ALL
    SELECT * FROM fallback WHERE NOT EXISTS (SELECT 1 FROM candidates)
  ) c
  ORDER BY score DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pick_next_nurture_angle(uuid) TO authenticated, service_role;

-- 4. Seed 9 angles (global, branch_id NULL)
INSERT INTO public.lead_nurture_angles (slug, label, tone, prompt_hint, fallback_template, weight) VALUES
('value',                'Value & Outcomes',          'warm',
 'Lead with a single concrete benefit a member gets here (recovery, coached PT, premium equipment). One line, no list.',
 'Hi {name}! Quick thought — most folks who join us tell us recovery is what keeps them coming back. Want to come see the lounge this week?', 2),
('social_proof',         'Social Proof',              'consultative',
 'Reference how members or the Udaipur community is using the club (PT, classes, recovery). Specific, not generic.',
 'Hi {name}! Our PT floor stays busy every evening — happy to walk you through what a typical week looks like for our members. Free for a quick chat?', 1),
('founder_scarcity',     'Founder Window',            'urgent_soft',
 'Mention that founding-member access is open before launch. Do not invent prices, slots, or counts — just the soft scarcity of the pre-launch window.',
 'Hi {name}! Founding-member access is open while we get ready to open in Sector 14. Want me to hold a spot for a walkthrough?', 2),
('curiosity',            'Curiosity Hook',            'curious',
 'Open with a short question that pulls them back into the conversation — about their goal or what stopped them last time.',
 'Hi {name}! Quick one — what would make joining a club a no-brainer for you right now?', 1),
('soft_cta',             'Soft CTA',                  'warm',
 'Low-pressure invite to a tour or a callback. No urgency, no pitch — just an open door.',
 'Hi {name}! No pressure at all — whenever you''d like a quick tour of the club, I can set it up. Just say the word.', 1),
('question_led',         'Goal Question',             'consultative',
 'Ask one specific question about their fitness goal so we can tailor the next message. Reference their goal if known.',
 'Hi {name}! Curious — is your focus more on weight loss, strength, or just feeling better day-to-day? Helps me point you to the right setup.', 1),
('recovery_focus',       'Recovery Angle',            'warm',
 'Lead with the recovery side — infrared sauna, ice bath, steam, recovery lounge. One short sentence + soft invite.',
 'Hi {name}! Most members say our recovery zone is the unfair advantage — sauna, ice bath, steam, all in one space. Want to try it on your tour?', 1),
('transformation_story', 'Transformation Frame',      'warm',
 'Frame the next 90 days. Paint a small, believable picture of what changes when training is consistent. Never promise outcomes.',
 'Hi {name}! 90 days of consistent training here genuinely changes how people feel. Worth a 15-minute look around?', 1),
('community',            'Community & Vibe',          'playful',
 'Lean into the vibe — group classes (Zumba/Pilates/Yoga), Panatta strength floor, the energy on the floor. Light, not salesy.',
 'Hi {name}! The energy on the floor in the evenings is honestly the best part — classes, strength, recovery, all in one club. Come feel it?', 1);
