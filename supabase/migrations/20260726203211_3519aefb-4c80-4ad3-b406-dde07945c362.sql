
-- =====================================================
-- 1. IST-aware membership activation & expiry
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
    SELECT id, member_id, branch_id
      FROM public.memberships
     WHERE status = 'pending'::public.membership_status
       AND start_date <= v_today
       AND end_date   >= v_today
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.memberships
       SET status = 'active'::public.membership_status, updated_at = now()
     WHERE id = v_row.id;

    UPDATE public.locker_assignments la
       SET is_active = true
     WHERE la.member_id = v_row.member_id
       AND la.start_date = (SELECT start_date FROM public.memberships WHERE id = v_row.id)
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

-- Re-schedule the cron to 00:35 IST daily = 19:05 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'activate_scheduled_memberships') THEN
    PERFORM cron.unschedule('activate_scheduled_memberships');
  END IF;
END
$$;

SELECT cron.schedule(
  'activate_scheduled_memberships',
  '5 19 * * *',
  $$ SELECT public.activate_scheduled_memberships(); $$
);

-- =====================================================
-- 2. Mirror members.biometric_photo_url → profiles.avatar_url
-- =====================================================
CREATE OR REPLACE FUNCTION public.tg_mirror_member_photo_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND NEW.biometric_photo_url IS NOT NULL
     AND NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url THEN
    UPDATE public.profiles
       SET avatar_url = NEW.biometric_photo_url,
           updated_at = now()
     WHERE id = NEW.user_id
       AND (avatar_url IS DISTINCT FROM NEW.biometric_photo_url);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_member_photo_to_profile ON public.members;
CREATE TRIGGER trg_mirror_member_photo_to_profile
AFTER UPDATE OF biometric_photo_url ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.tg_mirror_member_photo_to_profile();
