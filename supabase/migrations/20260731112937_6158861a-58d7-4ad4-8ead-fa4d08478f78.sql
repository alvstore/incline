UPDATE public.ai_purposes
SET max_tokens = 8000, updated_at = now()
WHERE purpose = 'fitness_plan' AND (max_tokens IS NULL OR max_tokens < 8000);