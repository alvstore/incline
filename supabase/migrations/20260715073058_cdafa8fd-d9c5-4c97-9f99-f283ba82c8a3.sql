UPDATE public.whatsapp_templates
SET is_stale = true,
    meta_last_error = 'Approved as body-only because Meta App ID was missing when submitted; re-create as v2 with header after adding App ID.'
WHERE name = 'choose_what_deserves_your_effort' AND is_stale IS DISTINCT FROM true;