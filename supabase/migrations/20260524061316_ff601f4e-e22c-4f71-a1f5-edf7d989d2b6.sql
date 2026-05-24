UPDATE public.ai_purposes
SET guards = COALESCE(guards, '{}'::jsonb) || jsonb_build_object(
  'non_fitness_redirect', true,
  'non_fitness_pause_nurture', true,
  'non_fitness_dedupe_window_hours', 24,
  'non_fitness_message', 'Thanks for reaching out! For careers, partnerships, vendor, media, or other non-membership inquiries please email *info@theinclinelife.com* or call our front desk. This channel is for membership and fitness queries only. 🙏',
  'non_fitness_pattern', '\b(job|jobs|vacancy|vacancies|hir(?:e|ing)|career|careers|cv|resume|biodata|bio[-\s]?data|interview\s+for|i(?:''?m)?\s+(?:looking\s+(?:for|out)\s+)?(?:a\s+)?(?:job|work|position|role|vacancy)|work(?:ing)?\s+(?:at|with|in)\s+(?:your|incline)|sales\s+(?:job|department|position)|trainer\s+(?:job|position|vacancy)|front\s*desk\s+(?:job|position)|vendor|supplier|wholesale|b2b|press|media|influencer|sponsor(?:ship)?|collaborat(?:e|ion)|partnership|franchise|tie[-\s]?up|physio(?:therapist|therapy)?|sports\s+physio|doctor|nutritionist|dietician|yoga\s+teacher|instructor\s+job)\b'
)
WHERE purpose = 'whatsapp_reply';