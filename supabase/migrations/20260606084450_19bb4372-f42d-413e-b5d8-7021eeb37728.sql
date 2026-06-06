WITH latest AS (
  SELECT DISTINCT ON (m.phone_number)
    m.phone_number, m.contact_name, m.platform
  FROM public.whatsapp_messages m
  WHERE m.direction = 'inbound'
    AND m.contact_name IS NOT NULL
    AND m.contact_name <> ''
    AND m.platform::text IN ('instagram','messenger')
  ORDER BY m.phone_number, m.created_at DESC
)
UPDATE public.whatsapp_chat_settings s
SET
  contact_name = COALESCE(NULLIF(s.contact_name,''), latest.contact_name),
  external_username = COALESCE(
    NULLIF(s.external_username,''),
    CASE WHEN latest.contact_name LIKE '@%' THEN regexp_replace(latest.contact_name, '^@', '') ELSE NULL END
  )
FROM latest
WHERE s.phone_number = latest.phone_number
  AND s.platform::text IN ('instagram','messenger')
  AND (s.contact_name IS NULL OR s.contact_name = '' OR s.external_username IS NULL OR s.external_username = '');

UPDATE public.whatsapp_chat_settings s
SET
  contact_name = COALESCE(NULLIF(s.contact_name,''), mem.profile->>'contact_name'),
  external_username = COALESCE(
    NULLIF(s.external_username,''),
    CASE WHEN (mem.profile->>'contact_name') LIKE '@%'
      THEN regexp_replace(mem.profile->>'contact_name','^@','')
      ELSE NULL END
  )
FROM public.ai_memory mem
WHERE s.platform::text IN ('instagram','messenger')
  AND s.phone_number = mem.contact_key
  AND s.platform::text = mem.platform::text
  AND (s.contact_name IS NULL OR s.contact_name = '' OR s.external_username IS NULL OR s.external_username = '')
  AND mem.profile ? 'contact_name';