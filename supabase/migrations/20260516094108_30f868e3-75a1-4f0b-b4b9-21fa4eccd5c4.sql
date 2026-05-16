-- Evergreen Campaign Template Library
ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS is_evergreen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evergreen_kind text;

ALTER TABLE public.templates
  DROP CONSTRAINT IF EXISTS templates_evergreen_kind_check;
ALTER TABLE public.templates
  ADD CONSTRAINT templates_evergreen_kind_check
  CHECK (evergreen_kind IS NULL OR evergreen_kind IN ('promotion','event','announcement','lead_reengagement'));

CREATE INDEX IF NOT EXISTS idx_templates_evergreen
  ON public.templates (evergreen_kind, type)
  WHERE is_evergreen = true AND is_active = true;

-- Seed 8 global evergreen templates (branch_id NULL = available to every branch)
-- meta_template_status starts as 'pending' — Settings → Communication Templates
-- can submit each to Meta via the existing "Submit to Meta" action. After Meta
-- approves, the wizard will start using them automatically.
INSERT INTO public.templates
  (branch_id, name, type, content, variables, is_evergreen, evergreen_kind, meta_template_name, header_type, is_active)
VALUES
  -- Promotion
  (NULL, 'Evergreen · Promo Offer (Generic)', 'whatsapp',
   'Hi {{1}}, an exclusive offer just for you at {{2}} — {{3}}. Reply *YES* to claim or visit the front desk. 💪',
   '["member_name","branch_name","offer_details"]'::jsonb,
   true, 'promotion', 'evergreen_promo_offer_generic', 'none', true),
  (NULL, 'Evergreen · Limited Time Discount', 'whatsapp',
   'Hi {{1}}, our {{2}} discount ends {{3}}. Don''t miss out — show this message at {{4}} to redeem.',
   '["member_name","offer_name","expiry","branch_name"]'::jsonb,
   true, 'promotion', 'evergreen_limited_time_discount', 'none', true),

  -- Event
  (NULL, 'Evergreen · Event Invite (Generic)', 'whatsapp',
   'Hi {{1}}, you''re invited to *{{2}}* on {{3}} at {{4}}. Venue: {{5}}. Reply *RSVP* to confirm your spot.',
   '["member_name","event_name","event_date","event_time","event_venue"]'::jsonb,
   true, 'event', 'evergreen_event_invite_generic', 'none', true),
  (NULL, 'Evergreen · Class Launch', 'whatsapp',
   'Hi {{1}}, we''re launching *{{2}}* at {{3}} starting {{4}}. Limited spots — book now to secure yours.',
   '["member_name","class_name","branch_name","start_date"]'::jsonb,
   true, 'event', 'evergreen_class_launch', 'none', true),

  -- Announcement
  (NULL, 'Evergreen · Announcement (Generic)', 'whatsapp',
   'Hi {{1}}, an update from {{2}}: {{3}}. For any questions please reach out to our front desk.',
   '["member_name","branch_name","announcement"]'::jsonb,
   true, 'announcement', 'evergreen_announcement_generic', 'none', true),
  (NULL, 'Evergreen · Schedule Change', 'whatsapp',
   'Hi {{1}}, please note: {{2}} hours/schedule will change on {{3}}. New timing: {{4}}. Thank you for understanding.',
   '["member_name","branch_name","change_date","new_timing"]'::jsonb,
   true, 'announcement', 'evergreen_schedule_change', 'none', true),

  -- Lead Re-engagement
  (NULL, 'Evergreen · Re-engage Lost Lead', 'whatsapp',
   'Hi {{1}}, we noticed you were interested in joining {{2}} a while ago. We''d love to have you back — would you like to schedule a quick tour or trial?',
   '["lead_name","branch_name"]'::jsonb,
   true, 'lead_reengagement', 'evergreen_reengage_lost_lead', 'none', true),
  (NULL, 'Evergreen · Trial Invitation', 'whatsapp',
   'Hi {{1}}, ready to start your fitness journey at {{2}}? We''d like to offer you a complimentary trial session — reply *TRIAL* to book.',
   '["lead_name","branch_name"]'::jsonb,
   true, 'lead_reengagement', 'evergreen_trial_invitation', 'none', true)
ON CONFLICT (type, meta_template_name) WHERE meta_template_name IS NOT NULL DO NOTHING;