CREATE TABLE IF NOT EXISTS public.mips_dispatch_state (
  mips_device_id integer PRIMARY KEY,
  branch_id uuid,
  last_dispatch_at timestamptz,
  in_flight_until timestamptz,
  dispatch_day date,
  dispatch_count integer NOT NULL DEFAULT 0,
  last_full_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mips_dispatch_state TO authenticated;
GRANT ALL ON public.mips_dispatch_state TO service_role;

ALTER TABLE public.mips_dispatch_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view mips dispatch state" ON public.mips_dispatch_state;
CREATE POLICY "Staff can view mips dispatch state"
ON public.mips_dispatch_state FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'manager'::app_role)
  OR public.has_role(auth.uid(), 'staff'::app_role)
);

CREATE OR REPLACE FUNCTION public.mips_claim_dispatch_slot(
  p_mips_device_id integer,
  p_branch_id uuid DEFAULT NULL,
  p_min_gap_seconds integer DEFAULT 5,
  p_daily_cap integer DEFAULT 800,
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

  IF v_row.in_flight_until IS NOT NULL AND v_row.in_flight_until > now() THEN
    RETURN false;
  END IF;

  IF v_row.last_dispatch_at IS NOT NULL
     AND v_row.last_dispatch_at > now() - make_interval(secs => p_min_gap_seconds) THEN
    RETURN false;
  END IF;

  IF v_row.dispatch_count >= p_daily_cap THEN
    RETURN false;
  END IF;

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

CREATE OR REPLACE FUNCTION public.mips_release_dispatch_slot(p_mips_device_id integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.mips_dispatch_state
     SET in_flight_until = NULL, updated_at = now()
   WHERE mips_device_id = p_mips_device_id;
$$;

CREATE OR REPLACE FUNCTION public.mips_claim_full_sync(
  p_mips_device_id integer,
  p_min_hours integer DEFAULT 24,
  p_force boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
BEGIN
  INSERT INTO public.mips_dispatch_state (mips_device_id)
  VALUES (p_mips_device_id)
  ON CONFLICT (mips_device_id) DO NOTHING;

  SELECT last_full_sync_at INTO v_last FROM public.mips_dispatch_state
   WHERE mips_device_id = p_mips_device_id FOR UPDATE;

  IF NOT p_force AND v_last IS NOT NULL
     AND v_last > now() - make_interval(hours => p_min_hours) THEN
    RETURN false;
  END IF;

  UPDATE public.mips_dispatch_state
     SET last_full_sync_at = now(), updated_at = now()
   WHERE mips_device_id = p_mips_device_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mips_claim_dispatch_slot(integer, uuid, integer, integer, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.mips_release_dispatch_slot(integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.mips_claim_full_sync(integer, integer, boolean) TO service_role, authenticated;

-- Face verdicts produced by the invalid photo-count attribution are not evidence.
UPDATE public.mips_device_face_state
   SET state = 'pending',
       attempts = 0,
       reason = 'Re-baselined: previous verdict came from full-roster sync attribution'
 WHERE state IN ('rejected', 'unverified');