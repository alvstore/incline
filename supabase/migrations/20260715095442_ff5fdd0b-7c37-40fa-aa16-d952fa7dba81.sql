UPDATE public.templates
SET variables = CASE
  WHEN content ~ '\{\{4\}\}' THEN '["first_name","var2","var3","var4"]'::jsonb
  WHEN content ~ '\{\{3\}\}' THEN '["first_name","var2","var3"]'::jsonb
  WHEN content ~ '\{\{2\}\}' THEN '["first_name","var2"]'::jsonb
  WHEN content ~ '\{\{1\}\}' THEN '["first_name"]'::jsonb
  ELSE variables
END
WHERE type = 'whatsapp'
  AND (variables IS NULL OR variables = '[]'::jsonb)
  AND content ~ '\{\{\d+\}\}';