ALTER TABLE public.mips_sync_attempts
  DROP CONSTRAINT IF EXISTS mips_sync_attempts_status_chk;

ALTER TABLE public.mips_sync_attempts
  ADD CONSTRAINT mips_sync_attempts_status_chk
  CHECK (status IN ('pending','processing','success','failed','abandoned','deferred','skipped'));

CREATE OR REPLACE FUNCTION public.mips_claim_dispatch_slot(
  p_mips_device_id integer,
  p_branch_id uuid DEFAULT NULL,
  p_min_gap_seconds integer DEFAULT 5,
  p_daily_cap integer DEFAULT 100,
  p_in_flight_seconds integer DEFAULT 20
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mips_dispatch_state%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  INSERT INTO public.mips_dispatch_state (mips_device_id, branch_id, dispatch_day)
  VALUES (p_mips_device_id, p_branch_id, v_today)
  ON CONFLICT (mips_device_id) DO NOTHING;

  SELECT * INTO v_row FROM public.mips_dispatch_state
   WHERE mips_device_id = p_mips_device_id FOR UPDATE;

  IF v_row.dispatch_day IS DISTINCT FROM v_today THEN
    v_row.dispatch_day := v_today;
    v_row.dispatch_count := 0;
  END IF;
  IF v_row.in_flight_until IS NOT NULL AND v_row.in_flight_until > now() THEN RETURN false; END IF;
  IF v_row.last_dispatch_at IS NOT NULL
     AND v_row.last_dispatch_at > now() - make_interval(secs => p_min_gap_seconds) THEN RETURN false; END IF;
  IF v_row.dispatch_count >= p_daily_cap THEN RETURN false; END IF;

  UPDATE public.mips_dispatch_state
     SET branch_id = COALESCE(p_branch_id, branch_id),
         last_dispatch_at = now(),
         in_flight_until = now() + make_interval(secs => p_in_flight_seconds),
         dispatch_day = v_today,
         dispatch_count = v_row.dispatch_count + 1,
         updated_at = now()
   WHERE mips_device_id = p_mips_device_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mips_claim_dispatch_slot(integer, uuid, integer, integer, integer)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mips_claim_dispatch_slot(integer, uuid, integer, integer, integer)
  TO service_role;