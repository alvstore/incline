
-- 1. Helper: read members.branch_id without re-entering RLS on members.
CREATE OR REPLACE FUNCTION public.member_branch_id(_member_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.members WHERE id = _member_id
$$;

REVOKE ALL ON FUNCTION public.member_branch_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_branch_id(uuid) TO authenticated, service_role;

-- 2. Rewrite the branch-scoped policies to use the helper.

-- member_comps
DROP POLICY IF EXISTS "Managers and staff manage comps in visible branches" ON public.member_comps;
CREATE POLICY "Managers and staff manage comps in visible branches"
  ON public.member_comps
  FOR ALL
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND public.member_branch_id(member_id) IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND public.member_branch_id(member_id) IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );

-- member_pt_packages
DROP POLICY IF EXISTS "member_pt_select_own_or_branch" ON public.member_pt_packages;
CREATE POLICY "member_pt_select_own_or_branch"
  ON public.member_pt_packages
  FOR SELECT
  TO authenticated
  USING (
    member_id = get_member_id(auth.uid())
    OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
      AND public.member_branch_id(member_id) IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "staff_write_member_pt_branch_scoped" ON public.member_pt_packages;
CREATE POLICY "staff_write_member_pt_branch_scoped"
  ON public.member_pt_packages
  FOR ALL
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND public.member_branch_id(member_id) IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND public.member_branch_id(member_id) IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );

-- 3. Fix trigger to insert into biometric_sync_queue using real columns.
CREATE OR REPLACE FUNCTION public.tg_push_photo_to_mips()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_person_type text;
  v_hw_enabled boolean;
  v_new_photo text;
  v_old_photo text;
  v_person_name text;
  v_request_id bigint;
  v_supabase_url text := 'https://iyqqpbvnszyrrgerniog.supabase.co';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';
BEGIN
  IF TG_TABLE_NAME = 'members' THEN
    v_person_type := 'member';
  ELSIF TG_TABLE_NAME = 'employees' THEN
    v_person_type := 'employee';
  ELSIF TG_TABLE_NAME = 'trainers' THEN
    v_person_type := 'trainer';
  ELSE
    RETURN NEW;
  END IF;

  v_new_photo := (row_to_json(NEW) ->> 'biometric_photo_url');
  v_old_photo := (row_to_json(OLD) ->> 'biometric_photo_url');
  v_hw_enabled := COALESCE((row_to_json(NEW) ->> 'hardware_access_enabled')::boolean, true);
  v_person_name := COALESCE(
    (row_to_json(NEW) ->> 'full_name'),
    (row_to_json(NEW) ->> 'name'),
    ''
  );

  IF v_new_photo IS NULL OR btrim(v_new_photo) = '' THEN
    RETURN NEW;
  END IF;
  IF v_new_photo IS NOT DISTINCT FROM v_old_photo THEN
    RETURN NEW;
  END IF;
  IF NOT v_hw_enabled THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT net.http_post(
      url := v_supabase_url || '/functions/v1/sync-to-mips',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_anon_key,
        'Authorization', 'Bearer ' || v_anon_key,
        'x-lovable-system', 'photo-upload-trigger'
      ),
      body := jsonb_build_object(
        'person_id', NEW.id,
        'person_type', v_person_type,
        'action', 'upsert',
        'branch_id', (row_to_json(NEW) ->> 'branch_id')
      )
    ) INTO v_request_id;

    INSERT INTO public.biometric_sync_queue (
      member_id, staff_id, sync_type, photo_url,
      person_uuid, person_name, status, retry_count, queued_at
    ) VALUES (
      CASE WHEN v_person_type = 'member' THEN NEW.id ELSE NULL END,
      CASE WHEN v_person_type IN ('employee','trainer') THEN NEW.id ELSE NULL END,
      'photo_upload',
      v_new_photo,
      NEW.id,
      v_person_name,
      'pending',
      0,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs (source, severity, error_message, function_name, context, status, created_at)
      VALUES ('trigger', 'warning', SQLERRM, 'tg_push_photo_to_mips',
              jsonb_build_object('person_type', v_person_type, 'person_id', NEW.id),
              'open', now());
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  RETURN NEW;
END;
$function$;
