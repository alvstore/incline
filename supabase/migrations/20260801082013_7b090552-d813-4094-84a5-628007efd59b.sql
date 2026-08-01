CREATE OR REPLACE FUNCTION public.tg_push_photo_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_type text;
  v_hw_enabled boolean;
  v_new_path text;
  v_old_path text;
  v_new_url text;
  v_old_url text;
  v_photo_ref text;
  v_person_name text;
BEGIN
  v_person_type := CASE TG_TABLE_NAME
    WHEN 'members' THEN 'member'
    WHEN 'employees' THEN 'employee'
    WHEN 'trainers' THEN 'trainer'
    ELSE NULL
  END;
  IF v_person_type IS NULL THEN RETURN NEW; END IF;

  v_new_path := row_to_json(NEW)->>'biometric_photo_path';
  v_new_url := row_to_json(NEW)->>'biometric_photo_url';
  IF TG_OP = 'UPDATE' THEN
    v_old_path := row_to_json(OLD)->>'biometric_photo_path';
    v_old_url := row_to_json(OLD)->>'biometric_photo_url';
  END IF;
  v_photo_ref := COALESCE(NULLIF(btrim(v_new_path), ''), NULLIF(btrim(v_new_url), ''));
  v_hw_enabled := COALESCE((row_to_json(NEW)->>'hardware_access_enabled')::boolean, true);

  IF v_photo_ref IS NULL OR NOT v_hw_enabled THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND v_new_path IS NOT DISTINCT FROM v_old_path
     AND v_new_url IS NOT DISTINCT FROM v_old_url THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.full_name, row_to_json(NEW)->>'full_name', row_to_json(NEW)->>'name', '')
    INTO v_person_name
  FROM (SELECT 1) seed
  LEFT JOIN public.profiles p ON p.id = NULLIF(row_to_json(NEW)->>'user_id','')::uuid;

  INSERT INTO public.biometric_sync_queue (
    member_id, staff_id, sync_type, photo_url, person_uuid, person_type,
    person_name, status, retry_count, queued_at, processed_at, error_message
  ) VALUES (
    CASE WHEN v_person_type='member' THEN NEW.id ELSE NULL END,
    CASE WHEN v_person_type='employee' THEN NEW.id ELSE NULL END,
    'photo_upload', v_photo_ref, NEW.id::text, v_person_type,
    COALESCE(NULLIF(v_person_name,''), initcap(v_person_type)),
    'pending', 0, now(), NULL, NULL
  )
  ON CONFLICT (person_uuid, device_id) DO UPDATE SET
    person_type = EXCLUDED.person_type,
    photo_url = EXCLUDED.photo_url,
    person_name = EXCLUDED.person_name,
    status = 'pending',
    retry_count = 0,
    queued_at = now(),
    processed_at = NULL,
    error_message = NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event(
    'warning','database',SQLERRM,'tg_push_photo_to_mips',NULL,TG_TABLE_NAME,
    NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('person_type',v_person_type,'person_id',NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_photo_to_mips_members ON public.members;
CREATE TRIGGER trg_push_photo_to_mips_members
AFTER INSERT OR UPDATE OF biometric_photo_path, biometric_photo_url ON public.members
FOR EACH ROW EXECUTE FUNCTION public.tg_push_photo_to_mips();

DROP TRIGGER IF EXISTS trg_push_photo_to_mips_employees ON public.employees;
CREATE TRIGGER trg_push_photo_to_mips_employees
AFTER INSERT OR UPDATE OF biometric_photo_path, biometric_photo_url ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.tg_push_photo_to_mips();

DROP TRIGGER IF EXISTS trg_push_photo_to_mips_trainers ON public.trainers;
CREATE TRIGGER trg_push_photo_to_mips_trainers
AFTER INSERT OR UPDATE OF biometric_photo_path, biometric_photo_url ON public.trainers
FOR EACH ROW EXECUTE FUNCTION public.tg_push_photo_to_mips();