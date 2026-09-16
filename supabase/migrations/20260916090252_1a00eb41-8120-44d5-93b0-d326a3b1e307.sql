
-- 1. Dispatch now also carries the hardware sync secret (mips-access accepts it)
CREATE OR REPLACE FUNCTION private.mips_dispatch(p_fn text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public', 'extensions'
AS $function$
DECLARE
  v_url text;
  v_key text;
  v_secret text;
  v_hw text;
  v_headers jsonb;
BEGIN
  SELECT value INTO v_url FROM private.trigger_config WHERE key = 'supabase_url';
  v_key := private.mips_service_key();
  v_secret := private.mips_webhook_secret();
  SELECT mips_sync_secret INTO v_hw
    FROM public.branch_sync_secrets
   WHERE mips_sync_secret IS NOT NULL
   ORDER BY branch_id NULLS FIRST
   LIMIT 1;

  IF v_url IS NULL THEN
    RAISE WARNING 'mips_dispatch: missing url, skipping %', p_fn;
    RETURN;
  END IF;

  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-system-call', 'db-webhook');
  IF v_key IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  END IF;
  IF v_secret IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('x-sync-webhook-secret', v_secret);
  END IF;
  IF v_hw IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('x-hardware-sync-secret', v_hw);
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/' || p_fn,
    headers := v_headers,
    body := p_body,
    timeout_milliseconds := 8000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mips_dispatch(%) failed: %', p_fn, SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION private.mips_dispatch(text, jsonb) FROM PUBLIC, anon, authenticated;

-- 2. Photo/avatar changes go onto the existing biometric sync queue, drained by
--    process-biometric-sync-queue (which holds a valid service key).
CREATE OR REPLACE FUNCTION private.mips_enqueue_photo(p_person_type text, p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public', 'extensions'
AS $function$
DECLARE
  v_name text;
  v_photo text;
BEGIN
  IF p_person_type = 'member' THEN
    SELECT coalesce(p.full_name, l.full_name, m.member_code, 'Member'),
           coalesce(m.biometric_photo_url, m.biometric_photo_path, 'queued')
      INTO v_name, v_photo
      FROM public.members m
      LEFT JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.leads l ON l.id = m.lead_id
     WHERE m.id = p_person_id;
  ELSIF p_person_type = 'employee' THEN
    SELECT coalesce(p.full_name, e.employee_code, 'Employee'),
           coalesce(e.biometric_photo_url, e.biometric_photo_path, 'queued')
      INTO v_name, v_photo
      FROM public.employees e
      LEFT JOIN public.profiles p ON p.id = e.user_id
     WHERE e.id = p_person_id;
  ELSE
    SELECT coalesce(p.full_name, t.trainer_code, 'Trainer'),
           coalesce(t.biometric_photo_url, t.biometric_photo_path, 'queued')
      INTO v_name, v_photo
      FROM public.trainers t
      LEFT JOIN public.profiles p ON p.id = t.user_id
     WHERE t.id = p_person_id;
  END IF;

  IF v_name IS NULL THEN
    RETURN;
  END IF;

  -- Never stack duplicates for the same person.
  IF EXISTS (
    SELECT 1 FROM public.biometric_sync_queue
     WHERE person_uuid = p_person_id
       AND coalesce(status, 'pending') IN ('pending', 'syncing')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.biometric_sync_queue
    (member_id, staff_id, person_uuid, person_type, person_name, photo_url, sync_type, status, retry_count)
  VALUES (
    CASE WHEN p_person_type = 'member' THEN p_person_id END,
    CASE WHEN p_person_type <> 'member' THEN p_person_id END,
    p_person_id, p_person_type, v_name, v_photo, 'update', 'pending', 0
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mips_enqueue_photo(%,%) failed: %', p_person_type, p_person_id, SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION private.mips_enqueue_photo(text, uuid) FROM PUBLIC, anon, authenticated;

-- 3. Person webhook: photo/avatar path now enqueues instead of direct call
CREATE OR REPLACE FUNCTION public.fn_mips_person_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  v_person_type text;
  v_photo_changed boolean := false;
  v_avatar_changed boolean := false;
  v_due_changed boolean := false;
  v_changed jsonb;
  v_revoke boolean := false;
BEGIN
  v_person_type := CASE TG_TABLE_NAME
    WHEN 'members' THEN 'member'
    WHEN 'employees' THEN 'employee'
    ELSE 'trainer' END;

  IF TG_OP = 'INSERT' THEN
    v_photo_changed := NEW.biometric_photo_path IS NOT NULL OR NEW.biometric_photo_url IS NOT NULL;
  ELSE
    v_photo_changed :=
      NEW.biometric_photo_path IS DISTINCT FROM OLD.biometric_photo_path
      OR NEW.mips_photo_hash IS DISTINCT FROM OLD.mips_photo_hash;
    v_avatar_changed :=
      NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url
      OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path;
  END IF;

  IF TG_TABLE_NAME = 'members' THEN
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.hardware_access_status IS DISTINCT FROM OLD.hardware_access_status
        OR NEW.hardware_access_enabled IS DISTINCT FROM OLD.hardware_access_enabled
        OR NEW.status IS DISTINCT FROM OLD.status;
      v_revoke := coalesce(NEW.hardware_access_enabled, true) = false
        OR coalesce(NEW.hardware_access_status, 'active') <> 'active'
        OR NEW.status::text <> 'active';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.exit_date IS DISTINCT FROM OLD.exit_date;
      v_revoke := coalesce(NEW.is_active, true) = false OR NEW.exit_date IS NOT NULL;
    END IF;
  END IF;

  IF NOT (v_photo_changed OR v_avatar_changed OR v_due_changed) THEN
    RETURN NEW;
  END IF;

  v_changed := jsonb_build_object(
    'photo_changed', v_photo_changed,
    'avatar_changed', v_avatar_changed,
    'due_changed', v_due_changed
  );

  IF v_due_changed THEN
    IF TG_TABLE_NAME = 'members' THEN
      PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
        'action', CASE WHEN v_revoke THEN 'revoke' ELSE 'restore' END,
        'member_id', NEW.id,
        'branch_id', NEW.branch_id,
        'reason', 'DB webhook: access state changed',
        'person_type', v_person_type,
        'changed_fields', v_changed
      ));
    ELSE
      PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
        'action', CASE WHEN v_revoke THEN 'revoke_staff' ELSE 'restore_staff' END,
        'person_type', v_person_type,
        'person_id', NEW.id,
        'branch_id', NEW.branch_id,
        'reason', 'DB webhook: staff state changed',
        'changed_fields', v_changed
      ));
    END IF;
  END IF;

  IF v_photo_changed AND coalesce(NEW.mips_sync_status, '') = 'photo_rejected' THEN
    EXECUTE format('UPDATE public.%I SET mips_sync_status = %L WHERE id = %L',
                   TG_TABLE_NAME, 'pending', NEW.id);
    NEW.mips_sync_status := 'pending';
  END IF;

  IF (v_photo_changed OR v_avatar_changed)
     AND coalesce(NEW.mips_sync_status, '') NOT IN ('photo_rejected', 'revoked') THEN
    PERFORM private.mips_enqueue_photo(v_person_type, NEW.id);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_person_webhook failed for %.%: %', TG_TABLE_NAME, NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 4. Profile avatar webhook: same queue-based path
CREATE OR REPLACE FUNCTION public.fn_mips_profile_avatar_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  r record;
BEGIN
  IF NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT 'member'::text AS pt, id, mips_sync_status FROM public.members WHERE user_id = NEW.id
    UNION ALL
    SELECT 'employee', id, mips_sync_status FROM public.employees WHERE user_id = NEW.id
    UNION ALL
    SELECT 'trainer', id, mips_sync_status FROM public.trainers WHERE user_id = NEW.id
  LOOP
    CONTINUE WHEN coalesce(r.mips_sync_status, '') IN ('photo_rejected', 'revoked');
    PERFORM private.mips_enqueue_photo(r.pt, r.id);
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_profile_avatar_webhook failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
