-- 1. Allow privileged staff to delete retry-queue rows (Clear exhausted / Stop all)
DROP POLICY IF EXISTS "Staff can delete retry queue" ON public.communication_retry_queue;
CREATE POLICY "Staff can delete retry queue"
ON public.communication_retry_queue
FOR DELETE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]));

-- 2. Targeted MIPS sync on hardware access change (was: blanket sweep with NULL branch)
CREATE OR REPLACE FUNCTION public.tg_sync_hardware_access_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_action text;
BEGIN
  IF NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT mips_sync_secret INTO v_secret
  FROM public.branch_settings
  WHERE (branch_id = NEW.branch_id OR branch_id IS NULL)
  ORDER BY branch_id NULLS LAST
  LIMIT 1;

  v_action := CASE WHEN NEW.new_status = 'active' THEN 'restore' ELSE 'revoke' END;

  PERFORM net.http_post(
    url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/mips-access',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hardware-sync-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object(
      'action', v_action,
      'member_id', NEW.member_id,
      'branch_id', NEW.branch_id,
      'reason', COALESCE(NEW.reason, 'access state change')
    ),
    timeout_milliseconds := 8000
  );

  RETURN NEW;
END;
$$;

-- 3. Safety net: also restore members whose access flip was never confirmed on hardware
CREATE OR REPLACE FUNCTION public.members_restorable_after_dues()
RETURNS TABLE(member_id uuid, member_code text, branch_id uuid, mips_person_sn text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.member_code, m.branch_id, m.mips_person_sn
  FROM public.members m
  WHERE m.mips_person_sn IS NOT NULL
    AND (
      (m.hardware_access_status <> 'active'
        AND COALESCE(m.hardware_access_reason, '') IN ('dues', 'dues_cleared'))
      OR EXISTS (
        SELECT 1 FROM public.hardware_access_events e
        WHERE e.member_id = m.id
          AND e.requires_sync IS TRUE
          AND e.new_status = 'active'
          AND e.created_at > now() - interval '7 days'
      )
    )
    AND (public.member_access_status(m.id, m.branch_id) ->> 'allowed')::boolean IS TRUE
    AND EXISTS (
      SELECT 1 FROM public.memberships ms
      WHERE ms.member_id = m.id
        AND ms.status = 'active'
        AND ms.end_date >= current_date
    );
$$;

GRANT EXECUTE ON FUNCTION public.members_restorable_after_dues() TO service_role;