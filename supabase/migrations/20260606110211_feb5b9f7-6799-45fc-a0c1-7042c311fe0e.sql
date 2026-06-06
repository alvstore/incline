
-- 1. EMPLOYEES: split self-read from admin-write
DROP POLICY IF EXISTS admin_access_employees ON public.employees;

CREATE POLICY employees_self_select
ON public.employees
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY employees_admin_manage
ON public.employees
FOR ALL
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  )
);

-- 2. MEMBERS: scope trainers to assigned members only
DROP POLICY IF EXISTS "View members policy" ON public.members;

CREATE POLICY "View members policy"
ON public.members
FOR SELECT
TO authenticated
USING (
  -- Member viewing self
  user_id = auth.uid()
  -- Owners/admins: full visibility
  OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  -- Managers/staff: branch-scoped (trainers intentionally excluded)
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (branch_id = public.get_user_branch(auth.uid()) OR public.manages_branch(auth.uid(), branch_id))
  )
  -- Trainers: only members directly assigned or holding an active PT package with them
  OR (
    public.has_role(auth.uid(), 'trainer'::app_role)
    AND (
      assigned_trainer_id IN (
        SELECT t.id FROM public.trainers t WHERE t.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.member_pt_packages mpp
        JOIN public.trainers t ON t.id = mpp.trainer_id
        WHERE mpp.member_id = members.id
          AND t.user_id = auth.uid()
          AND mpp.status = 'active'
      )
    )
  )
);

-- 3. STORAGE member-photos: explicit avatars policy (other prefixes remain deny-by-default)
DROP POLICY IF EXISTS "Authorized users can view member avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can upload member avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can update member avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can delete member avatars" ON storage.objects;

CREATE POLICY "Authorized users can view member avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'member-photos' AND name LIKE 'avatars/%');

CREATE POLICY "Authorized users can upload member avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role, 'member'::app_role])
);

CREATE POLICY "Authorized users can update member avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'member-photos' AND name LIKE 'avatars/%')
WITH CHECK (bucket_id = 'member-photos' AND name LIKE 'avatars/%');

CREATE POLICY "Authorized users can delete member avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
);

-- 4. REALTIME: scope topic to branches the user can access.
-- Topic convention: anything containing 'branch:<uuid>' must match a branch the user can see.
-- Owners/admins keep cross-branch visibility; topics without an explicit branch tag remain readable
-- so per-user channels (e.g. 'user:<uuid>') still work.
DROP POLICY IF EXISTS "Authenticated users can read messages" ON realtime.messages;
DROP POLICY IF EXISTS "Allow authenticated read" ON realtime.messages;
DROP POLICY IF EXISTS "authenticated_read_messages" ON realtime.messages;
DROP POLICY IF EXISTS "realtime_messages_branch_scoped_select" ON realtime.messages;

CREATE POLICY "realtime_messages_branch_scoped_select"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Owners/admins: full cross-branch realtime access
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  -- Topic has no explicit branch tag: allow (user-scoped channels, presence, etc.)
  OR realtime.topic() !~ 'branch:[0-9a-f-]{36}'
  -- Topic carries a branch tag: must be one the user can see
  OR EXISTS (
    SELECT 1
    FROM public.user_visible_branch_ids(auth.uid()) AS b(branch_id)
    WHERE realtime.topic() LIKE '%branch:' || b.branch_id::text || '%'
  )
);
