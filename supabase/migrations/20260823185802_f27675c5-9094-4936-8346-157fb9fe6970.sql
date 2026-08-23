CREATE OR REPLACE FUNCTION public.can_use_realtime_topic(_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _topic IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      -- Branch-scoped topics: only branches the user can see.
      (
        _topic ~ 'branch:[0-9a-f-]{36}'
        AND (
          public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
          OR EXISTS (
            SELECT 1 FROM public.user_visible_branch_ids(auth.uid()) b(branch_id)
            WHERE _topic LIKE ('%branch:' || b.branch_id::text || '%')
          )
        )
      )
      -- Personal topics: strictly the caller's own user id.
      OR _topic = ('user:' || auth.uid()::text)
      -- Staff collaboration namespaces (presence + conversation typing).
      OR (
        _topic IN ('presence:app')
        OR _topic LIKE 'whatsapp:conv:%'
      ) AND public.has_any_role(
            auth.uid(),
            ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]
          )
    )
$$;

REVOKE ALL ON FUNCTION public.can_use_realtime_topic(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_use_realtime_topic(text) TO authenticated, service_role;

DROP POLICY IF EXISTS realtime_messages_branch_scoped_select ON realtime.messages;
DROP POLICY IF EXISTS realtime_messages_branch_scoped_insert ON realtime.messages;

CREATE POLICY realtime_messages_topic_allowlist_select
ON realtime.messages FOR SELECT TO authenticated
USING (public.can_use_realtime_topic(realtime.topic()));

CREATE POLICY realtime_messages_topic_allowlist_insert
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (public.can_use_realtime_topic(realtime.topic()));