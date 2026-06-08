UPDATE public.automation_rules SET is_active = false, updated_at = now() WHERE key = 'sync_ai_knowledge';
DELETE FROM public.ai_knowledge WHERE source_ref ~ '^(plan|pt|facility|branch):';