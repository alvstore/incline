-- 1. Enum for package type
DO $$ BEGIN
  CREATE TYPE public.pt_package_type AS ENUM ('session_based', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Migrate pt_packages.package_type (text -> enum)
ALTER TABLE public.pt_packages
  ALTER COLUMN package_type DROP DEFAULT;

UPDATE public.pt_packages
  SET package_type = 'monthly'
  WHERE package_type IN ('duration_based', 'monthly');

UPDATE public.pt_packages
  SET package_type = 'session_based'
  WHERE package_type NOT IN ('session_based', 'monthly') OR package_type IS NULL;

ALTER TABLE public.pt_packages
  ALTER COLUMN package_type TYPE public.pt_package_type
  USING package_type::public.pt_package_type;

ALTER TABLE public.pt_packages
  ALTER COLUMN package_type SET DEFAULT 'session_based',
  ALTER COLUMN package_type SET NOT NULL;

-- Allow total_sessions to be null for monthly packs
ALTER TABLE public.pt_packages
  ALTER COLUMN total_sessions DROP NOT NULL;

-- 3. Snapshot package_type on member_pt_packages
ALTER TABLE public.member_pt_packages
  ADD COLUMN IF NOT EXISTS package_type public.pt_package_type NOT NULL DEFAULT 'session_based';

-- Backfill snapshots from pt_packages
UPDATE public.member_pt_packages mp
  SET package_type = pp.package_type
  FROM public.pt_packages pp
  WHERE mp.package_id = pp.id AND mp.package_type IS DISTINCT FROM pp.package_type;

-- 4. Validation triggers (not CHECK — keep flexibility for future modes)
CREATE OR REPLACE FUNCTION public.validate_pt_package_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.package_type = 'session_based' THEN
    IF NEW.total_sessions IS NULL OR NEW.total_sessions <= 0 THEN
      RAISE EXCEPTION 'Session-based packages require total_sessions > 0';
    END IF;
  ELSIF NEW.package_type = 'monthly' THEN
    IF NEW.duration_months IS NULL OR NEW.duration_months <= 0 THEN
      RAISE EXCEPTION 'Monthly packages require duration_months > 0';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_pt_packages_shape ON public.pt_packages;
CREATE TRIGGER validate_pt_packages_shape
  BEFORE INSERT OR UPDATE ON public.pt_packages
  FOR EACH ROW EXECUTE FUNCTION public.validate_pt_package_shape();

CREATE OR REPLACE FUNCTION public.validate_member_pt_package_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.package_type = 'session_based' THEN
    IF NEW.sessions_total IS NULL OR NEW.sessions_total <= 0 THEN
      RAISE EXCEPTION 'Session-based member packages require sessions_total > 0';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_member_pt_packages_shape ON public.member_pt_packages;
CREATE TRIGGER validate_member_pt_packages_shape
  BEFORE INSERT OR UPDATE ON public.member_pt_packages
  FOR EACH ROW EXECUTE FUNCTION public.validate_member_pt_package_shape();

-- 5. Atomic log_pt_session RPC
CREATE OR REPLACE FUNCTION public.log_pt_session(
  p_member_pt_package_id uuid,
  p_trainer_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.member_pt_packages%ROWTYPE;
  v_session_id uuid;
  v_member_user_id uuid;
  v_member_phone text;
  v_member_name text;
  v_branch_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  -- Authz: trainer, manager, owner, admin
  IF NOT public.has_any_role(v_caller, ARRAY['owner','admin','manager','trainer']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock package row
  SELECT * INTO v_pkg
    FROM public.member_pt_packages
    WHERE id = p_member_pt_package_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  IF v_pkg.status <> 'active' THEN
    RAISE EXCEPTION 'package_not_active';
  END IF;

  -- Mode-specific validation
  IF v_pkg.package_type = 'session_based' THEN
    IF COALESCE(v_pkg.sessions_remaining, 0) <= 0 THEN
      RAISE EXCEPTION 'no_sessions_left';
    END IF;
  ELSIF v_pkg.package_type = 'monthly' THEN
    IF CURRENT_DATE > v_pkg.expiry_date THEN
      RAISE EXCEPTION 'package_expired';
    END IF;
  END IF;

  v_branch_id := v_pkg.branch_id;

  -- Insert session
  INSERT INTO public.pt_sessions (
    member_pt_package_id, trainer_id, branch_id,
    scheduled_at, status, notes, duration_minutes
  ) VALUES (
    v_pkg.id, p_trainer_id, v_branch_id,
    now(), 'completed', p_notes, 60
  ) RETURNING id INTO v_session_id;

  -- Decrement session counter for session-based packs
  IF v_pkg.package_type = 'session_based' THEN
    UPDATE public.member_pt_packages
      SET sessions_used = COALESCE(sessions_used, 0) + 1,
          sessions_remaining = GREATEST(0, COALESCE(sessions_remaining, 0) - 1),
          status = CASE
            WHEN COALESCE(sessions_remaining, 0) - 1 <= 0 THEN 'completed'::pt_package_status
            ELSE status
          END,
          updated_at = now()
      WHERE id = v_pkg.id
      RETURNING sessions_remaining INTO v_pkg.sessions_remaining;
  END IF;

  -- Best-effort WhatsApp receipt via communication dispatcher queue
  BEGIN
    SELECT p.id, p.full_name, p.phone
      INTO v_member_user_id, v_member_name, v_member_phone
      FROM public.members m
      JOIN public.profiles p ON p.id = m.user_id
      WHERE m.id = v_pkg.member_id;

    IF v_member_phone IS NOT NULL THEN
      INSERT INTO public.communication_logs (
        recipient_type, recipient_id, recipient_phone,
        channel, event_type, status, branch_id, payload, dedupe_key
      ) VALUES (
        'member', v_pkg.member_id, v_member_phone,
        'whatsapp', 'pt_session_logged', 'queued', v_branch_id,
        jsonb_build_object(
          'session_id', v_session_id,
          'package_type', v_pkg.package_type,
          'sessions_remaining', v_pkg.sessions_remaining,
          'expiry_date', v_pkg.expiry_date,
          'member_name', v_member_name
        ),
        'pt_session_logged:' || v_session_id::text
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never block session logging on receipt failure
    NULL;
  END;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'package_type', v_pkg.package_type,
    'sessions_remaining', v_pkg.sessions_remaining,
    'expiry_date', v_pkg.expiry_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_pt_session(uuid, uuid, text) TO authenticated;