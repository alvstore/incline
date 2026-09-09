-- 1) Password setup loop: allow the vetted RPC to clear must_set_password
CREATE OR REPLACE FUNCTION public.tg_profiles_block_privileged_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_password_setup boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / triggers
  END IF;
  IF public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN NEW;
  END IF;

  v_password_setup := coalesce(current_setting('app.password_setup', true), '') = 'true'
                      AND NEW.id = auth.uid()
                      AND OLD.must_set_password IS TRUE
                      AND NEW.must_set_password IS FALSE;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.government_id_verified IS DISTINCT FROM OLD.government_id_verified
     OR NEW.government_id_number IS DISTINCT FROM OLD.government_id_number
     OR (NEW.must_set_password IS DISTINCT FROM OLD.must_set_password AND NOT v_password_setup)
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
  THEN
    RAISE EXCEPTION 'Not allowed to modify protected account fields';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) First-time self enrolment of a face photo at /register
ALTER TABLE public.members     ADD COLUMN IF NOT EXISTS face_photo_source text;
ALTER TABLE public.employees   ADD COLUMN IF NOT EXISTS face_photo_source text;
ALTER TABLE public.trainers    ADD COLUMN IF NOT EXISTS face_photo_source text;

CREATE OR REPLACE FUNCTION public.tg_guard_biometric_photo_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed boolean;
  v_old_path text;
  v_old_url  text;
  v_owner    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / background workers
  END IF;

  v_changed :=
    (row_to_json(NEW)->>'biometric_photo_path') IS DISTINCT FROM (row_to_json(OLD)->>'biometric_photo_path')
    OR (row_to_json(NEW)->>'biometric_photo_url') IS DISTINCT FROM (row_to_json(OLD)->>'biometric_photo_url');

  IF NOT v_changed THEN RETURN NEW; END IF;

  IF public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]) THEN
    NEW.face_photo_source := coalesce(NEW.face_photo_source, 'staff');
    RETURN NEW;
  END IF;

  v_old_path := btrim(coalesce(row_to_json(OLD)->>'biometric_photo_path', ''));
  v_old_url  := btrim(coalesce(row_to_json(OLD)->>'biometric_photo_url', ''));
  v_owner    := nullif(row_to_json(OLD)->>'user_id', '')::uuid;

  -- One self-service write only: the person's own row, no face on file yet.
  IF v_owner IS NOT NULL AND v_owner = auth.uid()
     AND v_old_path = '' AND v_old_url = ''
     AND coalesce(row_to_json(OLD)->>'face_photo_source', '') = '' THEN
    NEW.face_photo_source := 'self_registration';
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Face photos can only be set by gym staff';
END;
$function$;

-- 3) MIPS photo fingerprint + separate gate-delivery status
ALTER TABLE public.members   ADD COLUMN IF NOT EXISTS mips_photo_hash text;
ALTER TABLE public.members   ADD COLUMN IF NOT EXISTS mips_photo_synced_at timestamptz;
ALTER TABLE public.members   ADD COLUMN IF NOT EXISTS mips_dispatch_status text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS mips_photo_hash text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS mips_photo_synced_at timestamptz;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS mips_dispatch_status text;
ALTER TABLE public.trainers  ADD COLUMN IF NOT EXISTS mips_photo_hash text;
ALTER TABLE public.trainers  ADD COLUMN IF NOT EXISTS mips_photo_synced_at timestamptz;
ALTER TABLE public.trainers  ADD COLUMN IF NOT EXISTS mips_dispatch_status text;