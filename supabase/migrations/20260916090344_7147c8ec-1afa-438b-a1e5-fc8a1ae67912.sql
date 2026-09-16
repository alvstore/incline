
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

  IF EXISTS (
    SELECT 1 FROM public.biometric_sync_queue
     WHERE person_uuid = p_person_id::text
       AND coalesce(status, 'pending') IN ('pending', 'syncing')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.biometric_sync_queue
    (member_id, staff_id, person_uuid, person_type, person_name, photo_url, sync_type, status, retry_count)
  VALUES (
    CASE WHEN p_person_type = 'member' THEN p_person_id END,
    CASE WHEN p_person_type <> 'member' THEN p_person_id END,
    p_person_id::text, p_person_type, v_name, v_photo, 'update', 'pending', 0
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mips_enqueue_photo(%,%) failed: %', p_person_type, p_person_id, SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION private.mips_enqueue_photo(text, uuid) FROM PUBLIC, anon, authenticated;
