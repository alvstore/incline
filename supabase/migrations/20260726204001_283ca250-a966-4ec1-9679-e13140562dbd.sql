
-- =====================================================
-- 1. Immediate backfill — clear stale pending_plan flags
-- =====================================================
UPDATE public.members mem
   SET lifecycle_state = 'active', updated_at = now()
 WHERE lifecycle_state = 'pending_plan'
   AND EXISTS (
     SELECT 1 FROM public.memberships m
      WHERE m.member_id = mem.id
        AND m.status = 'active'
        AND m.end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   );

-- =====================================================
-- 2. Patch activation cron to also lift lifecycle_state
-- =====================================================
CREATE OR REPLACE FUNCTION public.activate_scheduled_memberships()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count int := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR v_row IN
    SELECT id, member_id, branch_id, start_date
      FROM public.memberships
     WHERE status = 'pending'::public.membership_status
       AND start_date <= v_today
       AND end_date   >= v_today
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.memberships
       SET status = 'active'::public.membership_status, updated_at = now()
     WHERE id = v_row.id;

    UPDATE public.members
       SET lifecycle_state = 'active', updated_at = now()
     WHERE id = v_row.member_id
       AND lifecycle_state IN ('pending_plan', 'pending');

    UPDATE public.locker_assignments la
       SET is_active = true
     WHERE la.member_id = v_row.member_id
       AND la.start_date = v_row.start_date
       AND la.is_active = false;

    PERFORM public.log_member_lifecycle_event(
      v_row.branch_id, v_row.member_id, NULL, 'membership_activated',
      v_row.id, 'membership_started', 'pending', 'active',
      'cron', 'Advance booking activated on start date (IST)', NULL,
      jsonb_build_object('source', 'activate_scheduled_memberships', 'today_ist', v_today)
    );
    PERFORM public.evaluate_member_access_state(v_row.member_id, NULL, 'Scheduled membership activated', true);

    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('activated', v_count, 'today_ist', v_today, 'ran_at', now());
END;
$$;

-- =====================================================
-- 3. Trigger: clear pending_plan whenever a membership turns active
-- =====================================================
CREATE OR REPLACE FUNCTION public.tg_clear_pending_plan_on_membership_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active'::public.membership_status
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.members
       SET lifecycle_state = 'active', updated_at = now()
     WHERE id = NEW.member_id
       AND lifecycle_state IN ('pending_plan', 'pending');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_pending_plan_on_membership_active ON public.memberships;
CREATE TRIGGER trg_clear_pending_plan_on_membership_active
AFTER UPDATE OF status ON public.memberships
FOR EACH ROW
WHEN (NEW.status = 'active'::public.membership_status)
EXECUTE FUNCTION public.tg_clear_pending_plan_on_membership_active();

-- =====================================================
-- 4. Auto-push face to MIPS when photo uploaded
-- =====================================================
CREATE OR REPLACE FUNCTION public.tg_push_photo_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
    -- Never block the photo save on hardware sync errors
    INSERT INTO public.error_logs (source, severity, message, context, created_at)
    VALUES ('tg_push_photo_to_mips', 'warning', SQLERRM,
            jsonb_build_object('person_type', v_person_type, 'person_id', NEW.id), now());
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_photo_to_mips_members ON public.members;
CREATE TRIGGER trg_push_photo_to_mips_members
AFTER UPDATE OF biometric_photo_url ON public.members
FOR EACH ROW
WHEN (NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url)
EXECUTE FUNCTION public.tg_push_photo_to_mips();

DROP TRIGGER IF EXISTS trg_push_photo_to_mips_employees ON public.employees;
CREATE TRIGGER trg_push_photo_to_mips_employees
AFTER UPDATE OF biometric_photo_url ON public.employees
FOR EACH ROW
WHEN (NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url)
EXECUTE FUNCTION public.tg_push_photo_to_mips();

DROP TRIGGER IF EXISTS trg_push_photo_to_mips_trainers ON public.trainers;
CREATE TRIGGER trg_push_photo_to_mips_trainers
AFTER UPDATE OF biometric_photo_url ON public.trainers
FOR EACH ROW
WHEN (NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url)
EXECUTE FUNCTION public.tg_push_photo_to_mips();

-- =====================================================
-- 5. Security fix — access_devices no longer readable by ordinary members
-- =====================================================
DROP POLICY IF EXISTS "branch_scoped_devices_select" ON public.access_devices;
-- The "Managers can view branch devices" policy already limits SELECT to
-- owners, admins, and the manager of the branch — that stays in place.
