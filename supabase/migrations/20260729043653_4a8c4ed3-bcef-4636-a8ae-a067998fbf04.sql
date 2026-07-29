
-- Cluster 1: Drop legacy overloads causing PostgREST 300 ambiguity
DROP FUNCTION IF EXISTS public.staff_check_in(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.staff_check_out(uuid, text);

-- Cluster 2: Add self-serve policies for member_onboarding_signatures
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.member_onboarding_signatures'::regclass AND polname='mos_member_insert_own') THEN
    CREATE POLICY "mos_member_insert_own" ON public.member_onboarding_signatures
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.members m WHERE m.id = member_id AND m.user_id = auth.uid())
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.member_onboarding_signatures'::regclass AND polname='mos_member_select_own') THEN
    CREATE POLICY "mos_member_select_own" ON public.member_onboarding_signatures
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.members m WHERE m.id = member_id AND m.user_id = auth.uid())
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.member_onboarding_signatures'::regclass AND polname='mos_staff_manage') THEN
    CREATE POLICY "mos_staff_manage" ON public.member_onboarding_signatures
      FOR ALL TO authenticated
      USING (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::app_role[]))
      WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::app_role[]));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_onboarding_signatures TO authenticated;
GRANT ALL ON public.member_onboarding_signatures TO service_role;

-- Cluster 6: Patch tg_push_photo_to_mips to resolve trainer -> employee OR safely skip queue insert
CREATE OR REPLACE FUNCTION public.tg_push_photo_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_person_type text;
  v_hw_enabled boolean;
  v_new_photo text;
  v_old_photo text;
  v_person_name text;
  v_request_id bigint;
  v_staff_fk uuid;
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
  v_person_name := COALESCE((row_to_json(NEW) ->> 'full_name'), (row_to_json(NEW) ->> 'name'), '');

  IF v_new_photo IS NULL OR btrim(v_new_photo) = '' THEN RETURN NEW; END IF;
  IF v_new_photo IS NOT DISTINCT FROM v_old_photo THEN RETURN NEW; END IF;
  IF NOT v_hw_enabled THEN RETURN NEW; END IF;

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

    -- Resolve staff FK: employees.id directly, or map trainer -> employees via user_id
    v_staff_fk := NULL;
    IF v_person_type = 'employee' THEN
      v_staff_fk := NEW.id;
    ELSIF v_person_type = 'trainer' THEN
      SELECT e.id INTO v_staff_fk
      FROM public.employees e
      WHERE e.user_id = (row_to_json(NEW) ->> 'user_id')::uuid
      LIMIT 1;
    END IF;

    -- Skip queue row for trainers with no matching employee record (edge fn already fired)
    IF v_person_type = 'trainer' AND v_staff_fk IS NULL THEN
      RETURN NEW;
    END IF;

    BEGIN
      INSERT INTO public.biometric_sync_queue (
        member_id, staff_id, sync_type, photo_url,
        person_uuid, person_name, status, retry_count, queued_at
      ) VALUES (
        CASE WHEN v_person_type = 'member' THEN NEW.id ELSE NULL END,
        v_staff_fk,
        'photo_upload', v_new_photo, NEW.id, v_person_name, 'pending', 0, now()
      );
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;
    END;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs (source, severity, error_message, function_name, context, status, created_at)
      VALUES ('trigger', 'warning', SQLERRM, 'tg_push_photo_to_mips',
              jsonb_build_object('person_type', v_person_type, 'person_id', NEW.id),
              'open', now());
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;

  RETURN NEW;
END;
$func$;

-- Item 3: Enable realtime for attendance + access log tables (idempotent)
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.access_logs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.member_attendance; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_attendance; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.access_logs REPLICA IDENTITY FULL;
ALTER TABLE public.member_attendance REPLICA IDENTITY FULL;
ALTER TABLE public.staff_attendance REPLICA IDENTITY FULL;
