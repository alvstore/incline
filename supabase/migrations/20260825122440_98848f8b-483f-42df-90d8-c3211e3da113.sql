CREATE OR REPLACE FUNCTION public.can_access_biometric_photo(_user_id uuid, _path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_first text := split_part(coalesce(_path, ''), '/', 1);
  v_kind  text := split_part(coalesce(_path, ''), '/', 2);
  v_id    uuid;
  v_branch uuid;
  v_owner_user uuid;
BEGIN
  IF v_first <> 'biometric' THEN
    RETURN false;
  END IF;

  -- Only owners/admins get an unconditional bypass (they are org-wide by design).
  IF public.has_any_role(_user_id, ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN true;
  END IF;

  BEGIN
    v_id := split_part(split_part(_path, '/', 3), '.', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF v_kind = 'members' THEN
    SELECT m.branch_id, m.user_id INTO v_branch, v_owner_user FROM public.members m WHERE m.id = v_id;
  ELSIF v_kind = 'trainers' THEN
    SELECT t.branch_id, t.user_id INTO v_branch, v_owner_user FROM public.trainers t WHERE t.id = v_id;
  ELSIF v_kind = 'employees' THEN
    SELECT e.branch_id, e.user_id INTO v_branch, v_owner_user FROM public.employees e WHERE e.id = v_id;
  ELSE
    RETURN false;
  END IF;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Own photo.
  IF v_owner_user IS NOT NULL AND v_owner_user = _user_id THEN RETURN true; END IF;

  -- Branch-scoped staff (manager/staff/trainer) at the subject's branch.
  IF v_branch IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_visible_branch_ids(_user_id) b(id) WHERE b.id = v_branch
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;