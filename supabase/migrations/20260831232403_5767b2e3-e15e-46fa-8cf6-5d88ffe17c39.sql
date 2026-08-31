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
      -- Staff presence namespace.
      OR (
        _topic = 'presence:app'
        AND public.has_any_role(
              auth.uid(),
              ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]
            )
      )
      -- WhatsApp conversation typing/presence: branch-scoped topic
      -- `whatsapp:conv:<branch_uuid>:<key>`. Owners/admins may use any
      -- conversation topic (including the cross-branch `all` view).
      OR (
        _topic LIKE 'whatsapp:conv:%'
        AND (
          public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
          OR (
            public.has_any_role(
              auth.uid(),
              ARRAY['manager'::app_role,'staff'::app_role,'trainer'::app_role]
            )
            AND EXISTS (
              SELECT 1 FROM public.user_visible_branch_ids(auth.uid()) b(branch_id)
              WHERE _topic LIKE ('whatsapp:conv:' || b.branch_id::text || ':%')
            )
          )
        )
      )
    )
$$;