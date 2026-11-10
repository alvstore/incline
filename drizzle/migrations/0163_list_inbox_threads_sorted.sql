CREATE OR REPLACE FUNCTION public.list_inbox_threads(p_branch uuid DEFAULT NULL)
RETURNS TABLE (phone_number text, contact_name text, contact_avatar_url text, member_id uuid,
  last_message text, last_message_time timestamptz, direction text, platform text, has_messages boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (m.phone_number) m.phone_number, m.contact_name, m.contact_avatar_url, m.member_id,
      m.content, m.created_at, m.direction, m.platform::text AS platform
    FROM public.whatsapp_messages m
    WHERE (p_branch IS NULL OR m.branch_id = p_branch)
    ORDER BY m.phone_number, m.created_at DESC
  ), allrows AS (
    SELECT l.phone_number, l.contact_name, l.contact_avatar_url, l.member_id, l.content, l.created_at, l.direction, l.platform, true AS has_messages
    FROM latest l
    UNION ALL
    SELECT s.phone_number, s.contact_name, s.contact_avatar_url, NULL::uuid, NULL::text, s.updated_at, NULL::text, s.platform::text, false
    FROM public.whatsapp_chat_settings s
    WHERE s.platform = 'web_chat' AND (p_branch IS NULL OR s.branch_id = p_branch)
      AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.phone_number = s.phone_number)
  )
  SELECT * FROM allrows ORDER BY created_at DESC, phone_number
$$;