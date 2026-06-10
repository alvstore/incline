DROP POLICY IF EXISTS "Authenticated insert audit logs" ON public.audit_logs;
CREATE POLICY "Staff insert audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(
    auth.uid(),
    ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]
  )
  AND (user_id IS NULL OR user_id = auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can insert error logs" ON public.error_logs;
DROP POLICY IF EXISTS "Authenticated users can delete resolved error logs" ON public.error_logs;

CREATE POLICY "Staff can insert error logs"
ON public.error_logs
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(
    auth.uid(),
    ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]
  )
);

CREATE POLICY "Admins can delete resolved error logs"
ON public.error_logs
FOR DELETE
TO authenticated
USING (
  status = 'resolved'
  AND public.has_any_role(
    auth.uid(),
    ARRAY['owner'::public.app_role, 'admin'::public.app_role]
  )
);

DROP POLICY IF EXISTS "Staff can insert whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Staff can insert whatsapp messages"
ON public.whatsapp_messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role])
    AND public.is_branch_member(branch_id)
  )
);

DROP POLICY IF EXISTS "Staff can update whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Staff can update whatsapp messages"
ON public.whatsapp_messages
FOR UPDATE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role])
    AND public.is_branch_member(branch_id)
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role])
    AND public.is_branch_member(branch_id)
  )
);

DROP POLICY IF EXISTS "Staff can delete whatsapp messages" ON public.whatsapp_messages;
CREATE POLICY "Staff can delete whatsapp messages"
ON public.whatsapp_messages
FOR DELETE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role])
    AND public.is_branch_member(branch_id)
  )
);

CREATE OR REPLACE FUNCTION public.can_access_private_staff_media(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entity_type text := split_part(_path, '/', 1);
  v_entity_id uuid;
  v_branch_id uuid;
BEGIN
  BEGIN
    v_entity_id := split_part(_path, '/', 2)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF public.has_any_role(_user_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role]) THEN
    RETURN true;
  END IF;

  IF v_entity_type = 'trainers' THEN
    IF EXISTS (SELECT 1 FROM public.trainers t WHERE t.id = v_entity_id AND t.user_id = _user_id) THEN
      RETURN true;
    END IF;
    SELECT branch_id INTO v_branch_id FROM public.trainers WHERE id = v_entity_id;
  ELSIF v_entity_type = 'employees' THEN
    IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_entity_id AND e.user_id = _user_id) THEN
      RETURN true;
    END IF;
    SELECT branch_id INTO v_branch_id FROM public.employees WHERE id = v_entity_id;
  ELSE
    RETURN false;
  END IF;

  IF public.has_any_role(_user_id, ARRAY['manager'::public.app_role, 'staff'::public.app_role]) THEN
    RETURN v_branch_id IS NOT NULL
      AND v_branch_id = ANY (public.user_visible_branch_ids(_user_id));
  END IF;

  RETURN false;
END;
$function$;