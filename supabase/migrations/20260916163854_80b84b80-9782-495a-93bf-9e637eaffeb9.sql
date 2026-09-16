INSERT INTO public.whatsapp_triggers (branch_id, event_name, template_id, is_active)
SELECT b.id, e.event_name, '54c41c13-8234-49ea-8165-f8a10c1208b1'::uuid, true
FROM public.branches b
CROSS JOIN (VALUES ('facility_reminder'), ('universal_utility')) AS e(event_name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_triggers t
  WHERE t.branch_id = b.id AND t.event_name = e.event_name
);