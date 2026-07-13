INSERT INTO public.ai_knowledge (topic, title, content, source, priority, applies_to, is_active, status)
VALUES
  ('solicitor_handling', 'B2B marketplace / listing pitch (magicpin, JustDial, Sulekha, UrbanPro)',
   E'When the inbound message pitches a listing / marketplace / discovery service (magicpin, JustDial, Sulekha, UrbanPro, NoKnok, etc.), DO NOT treat the sender as a fitness lead and DO NOT ask for their name, email, goal, or plan interest. Reply once, politely, with:\n\n"Thanks for reaching out — Incline handles growth in-house and isn''t taking vendor / agency pitches on this channel. Please don''t add this number to outreach lists. 🙏"\n\nThen stop replying. Do not follow up. Do not create a lead.',
   'manual', 1, ARRAY['whatsapp_reply','all']::text[], true, 'active'),
  ('solicitor_handling', 'Ad / SEO / Google-review / social-growth agency pitch',
   E'When the sender offers to "manage your Google profile", "get more reviews", "boost your ranking", "run paid ads", "grow your Instagram/Facebook", or similar agency services, DO NOT enter the onboarding funnel. Send ONE polite decline (same wording as the marketplace pitch), then stop. Never ask for their email as a "Founding Member invite" — they are not a member.',
   'manual', 1, ARRAY['whatsapp_reply','all']::text[], true, 'active'),
  ('solicitor_handling', 'WhatsApp API / payment-gateway / SaaS reseller pitch',
   E'When the sender pitches WhatsApp Business API, payment gateways (Razorpay, PhonePe Business, Paytm for Business), Shopify Plus, CRM software, or any B2B SaaS reseller offer — treat as solicitation. One polite decline, no funnel, no lead capture.',
   'manual', 1, ARRAY['whatsapp_reply','all']::text[], true, 'active'),
  ('solicitor_handling', 'Signature / sender-tag heuristic ("from Tania, Vera by magicpin")',
   E'If the message ends with a signature block like "from <name>, <brand>" or contains "from our growth team", the sender is almost always a salesperson using a template — not a fitness lead. Even if their brand name looks like a person''s name (Vera, Tania), NEVER save it as the lead''s name. Decline once and stop.',
   'manual', 1, ARRAY['whatsapp_reply','all']::text[], true, 'active'),
  ('solicitor_handling', 'Cardinal rule — never robotically ask for email after a pitch',
   E'When any of the above solicitor patterns match, the reply MUST NOT be "Thanks, <name> — what''s the best email for your Founding Member invite? ✨". That prompt is reserved for genuine fitness leads only. Sending it to a salesperson makes Incline look like a poorly-tuned bot and burns the number for real outreach.',
   'manual', 1, ARRAY['whatsapp_reply','all']::text[], true, 'active');