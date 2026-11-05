ALTER TYPE public.messaging_platform ADD VALUE IF NOT EXISTS 'web_chat';

-- Remove duplicate / stale knowledge (Founder's Team wording, duplicated pricing & PT rows).
DELETE FROM public.ai_knowledge WHERE id IN (
  '67c99bf0-1b51-4d8d-b0a5-864e13d35345',
  '02a5ec9b-45a4-4ebb-bc1e-9b939efc8fd4',
  'f2eef7ac-ff69-4115-9c8e-82478eff443c'
);

-- Merge the out-of-window tour rule into the single visits row.
UPDATE public.ai_knowledge SET content =
 'Visits and tours are arranged Monday to Saturday, 09:00-20:00 IST (the club itself is open 24x7 for members). Offer a visit as the natural next step for anyone interested in joining, and capture a preferred day and time so the team can confirm. If someone proposes a time outside that window, politely offer the nearest valid slot instead. A visit is tentative until the team confirms it.',
 tags = ARRAY['visit','tour','web:visit'], applies_to = ARRAY['all','website_chat'], embedding = NULL
WHERE id = '1758e682-aaec-4e59-9fb2-91d4ab4dfaa9';

UPDATE public.ai_knowledge SET content = content || ' Members can view their PT sessions in the member portal at https://theincline.in/auth.', embedding = NULL
WHERE id = 'f6643d12-a633-48a6-98ec-cef30b3761e6' AND content NOT LIKE '%theincline.in/auth%';

-- Fact rows shared verbatim by WhatsApp AI and the website chat.
UPDATE public.ai_knowledge SET tags = array(SELECT DISTINCT unnest(coalesce(tags,'{}') || ARRAY['web:recovery'])), applies_to = ARRAY['all','website_chat'] WHERE id = 'e96a2c4e-a79f-47f3-8902-6bd4b0aeed55';
UPDATE public.ai_knowledge SET tags = array(SELECT DISTINCT unnest(coalesce(tags,'{}') || ARRAY['web:training_floor'])), applies_to = ARRAY['all','website_chat'] WHERE id = '25e03024-413c-4cef-961c-4c0b92978eeb';
UPDATE public.ai_knowledge SET tags = array(SELECT DISTINCT unnest(coalesce(tags,'{}') || ARRAY['web:assessment'])), applies_to = ARRAY['all','website_chat'] WHERE id = 'e938d7ee-0bfa-4667-b3d3-2d1f203322bc';

-- Visitor-facing answers for the website chat (website_chat only; WhatsApp keeps its own rules).
INSERT INTO public.ai_knowledge (topic, title, content, tags, priority, applies_to, is_active, status, source)
VALUES
 ('website_chat','Website: amenities','The club is fully air-conditioned, with QSC audio throughout and premium digital lockers.',ARRAY['web:amenities'],50,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: location','Incline is at Sector 14, Udaipur, Rajasthan.',ARRAY['web:location'],50,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: hours','Incline is open 24 hours a day, 7 days a week for members. Guided club visits are arranged Monday to Saturday, 9 AM to 8 PM.',ARRAY['web:hours'],50,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: membership','Memberships come in monthly, quarterly, half-yearly and annual durations, and can include recovery access, group classes and personal training. Our team explains what each option includes during your visit.',ARRAY['web:membership'],50,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: personal training & classes','Certified personal trainers offer one-to-one coaching, with Pilates, Yoga and Zumba group formats. The team shares the current trainers and class schedule with you.',ARRAY['web:pt_classes'],50,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: pricing','Incline follows a fixed and transparent pricing policy. We do not offer discounts or negotiate membership prices. Our focus is on the facilities, service and overall experience. Our team walks you through membership pricing and inclusions during your visit.',ARRAY['web:pricing','web:discount'],5,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: group / persistent discount escalation','For group membership enquiries or any further pricing discussion, please call our team directly on 8298293003.',ARRAY['web:group_pricing','web:escalation'],5,ARRAY['website_chat'],true,'active','manual'),
 ('website_chat','Website: unknown question','I don''t have a confirmed answer for that here, and I''d rather not guess. Our team can help during a club visit or a callback.',ARRAY['web:unknown'],50,ARRAY['website_chat'],true,'active','manual');