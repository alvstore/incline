
CREATE OR REPLACE FUNCTION public.can_access_member_avatar(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_filename text;
  v_prefix   text;
  v_owner_id uuid;
  v_member   public.members%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _path IS NULL THEN
    RETURN false;
  END IF;
  IF split_part(_path, '/', 1) <> 'avatars' THEN
    RETURN false;
  END IF;

  IF public.has_any_role(_user_id, ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN true;
  END IF;

  v_filename := split_part(_path, '/', 2);
  v_prefix   := split_part(v_filename, '-', 1) || '-'
             || split_part(v_filename, '-', 2) || '-'
             || split_part(v_filename, '-', 3) || '-'
             || split_part(v_filename, '-', 4) || '-'
             || split_part(split_part(v_filename, '-', 5), '.', 1);

  BEGIN
    v_owner_id := v_prefix::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  SELECT * INTO v_member
  FROM public.members
  WHERE user_id = v_owner_id OR id = v_owner_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_member.user_id = _user_id THEN
    RETURN true;
  END IF;

  IF v_member.branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.user_id = _user_id AND sb.branch_id = v_member.branch_id
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_write_member_avatar(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_filename text;
  v_prefix   text;
  v_owner_id uuid;
  v_member   public.members%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _path IS NULL THEN
    RETURN false;
  END IF;
  IF split_part(_path, '/', 1) <> 'avatars' THEN
    RETURN false;
  END IF;

  IF public.has_any_role(_user_id, ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN true;
  END IF;

  v_filename := split_part(_path, '/', 2);
  v_prefix   := split_part(v_filename, '-', 1) || '-'
             || split_part(v_filename, '-', 2) || '-'
             || split_part(v_filename, '-', 3) || '-'
             || split_part(v_filename, '-', 4) || '-'
             || split_part(split_part(v_filename, '-', 5), '.', 1);

  BEGIN
    v_owner_id := v_prefix::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  SELECT * INTO v_member
  FROM public.members
  WHERE user_id = v_owner_id OR id = v_owner_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_member.user_id = _user_id THEN
    RETURN true;
  END IF;

  IF v_member.branch_id IS NOT NULL
     AND public.has_any_role(_user_id, ARRAY['manager','staff']::public.app_role[])
     AND EXISTS (
       SELECT 1 FROM public.staff_branches sb
       WHERE sb.user_id = _user_id AND sb.branch_id = v_member.branch_id
     )
  THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_member_avatar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_member_avatar(uuid, text)  TO authenticated;

DROP POLICY IF EXISTS "Authorized users can view member avatars"   ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can upload member avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can update member avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can delete member avatars" ON storage.objects;

CREATE POLICY "Authorized users can view member avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND public.can_access_member_avatar(auth.uid(), name)
);

CREATE POLICY "Authorized users can upload member avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND public.can_write_member_avatar(auth.uid(), name)
);

CREATE POLICY "Authorized users can update member avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND public.can_write_member_avatar(auth.uid(), name)
)
WITH CHECK (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND public.can_write_member_avatar(auth.uid(), name)
);

CREATE POLICY "Authorized users can delete member avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'member-photos'
  AND name LIKE 'avatars/%'
  AND (
    public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
    OR public.can_write_member_avatar(auth.uid(), name)
  )
);
