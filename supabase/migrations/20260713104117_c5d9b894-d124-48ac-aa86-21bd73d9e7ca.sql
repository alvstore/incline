
INSERT INTO public.ai_knowledge (branch_id, topic, title, content, tags, priority, applies_to, status, source, is_active)
VALUES
  (NULL, 'location', 'Address & Google Maps',
   'The Incline is located at Sector 14, Udaipur, Rajasthan. Always share the Google Maps link on a new line when the address is mentioned: 📍 Google Maps: https://share.google/nO06sYYvXAVXFqugw. Geo: 24.546845, 73.701003.',
   ARRAY['location','address','map','directions','udaipur','sector 14','kaha','kahan','kidhar','where','pata'],
   100, ARRAY['whatsapp','instagram','messenger','ai_agent'], 'active', 'manual', true),

  (NULL, 'socials', 'Instagram handle',
   'Our Instagram handle is @inclineudaipur. Full URL: https://www.instagram.com/inclineudaipur/. Do not use any other spelling (never @incline.life, @incline_udaipur, @theincline, etc.). If a member says the handle is wrong or not found, apologise briefly and share the correct URL.',
   ARRAY['instagram','insta','ig','handle','social','profile','follow'],
   100, ARRAY['whatsapp','instagram','messenger','ai_agent'], 'active', 'manual', true),

  (NULL, 'socials', 'Other socials',
   'Primary social presence is Instagram (@inclineudaipur). For Facebook / YouTube / X, direct the member to follow us on Instagram for now — other channels will be shared personally by the team once live.',
   ARRAY['facebook','youtube','twitter','x','social media','handles'],
   80, ARRAY['whatsapp','instagram','messenger','ai_agent'], 'active', 'manual', true);
