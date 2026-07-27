CREATE OR REPLACE FUNCTION public.tg_push_photo_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_person_type text;
  v_hw_enabled boolean;
  v_new_photo text;
  v_old_photo text;
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
      person_id, person_type, branch_id, action, status, payload, attempts, created_at
    ) VALUES (
      NEW.id, v_person_type, ((row_to_json(NEW) ->> 'branch_id'))::uuid,
      'photo_upload', 'queued',
      jsonb_build_object('trigger', 'photo_upload', 'net_request_id', v_request_id, 'photo_url', v_new_photo),
      0, now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block the photo save on hardware sync errors.
    -- Use correct column name `error_message` (previous version used `message`,
    -- which does not exist on error_logs and caused profile UPDATEs to fail).
    BEGIN
      INSERT INTO public.error_logs (source, severity, error_message, function_name, context, status, created_at)
      VALUES ('trigger', 'warning', SQLERRM, 'tg_push_photo_to_mips',
              jsonb_build_object('person_type', v_person_type, 'person_id', NEW.id),
              'open', now());
    EXCEPTION WHEN OTHERS THEN
      NULL; -- swallow logging failures too
    END;
  END;

  RETURN NEW;
END;
$function$;