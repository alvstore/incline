-- Instant gate sync on person changes (no new edge functions: routes to
-- sync-to-mips for photo/avatar, mips-access for dues/validity-only changes).

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.mips_service_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, vault
AS $$
  SELECT coalesce(
    (SELECT value FROM private.trigger_config WHERE key = 'service_role_key'),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION private.mips_webhook_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private
AS $$
  SELECT value FROM private.trigger_config WHERE key = 'sync_webhook_secret';
$$;

-- Generic dispatcher: posts to an existing edge function with service-role auth
CREATE OR REPLACE FUNCTION private.mips_dispatch(p_fn text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
  v_secret text;
  v_headers jsonb;
BEGIN
  SELECT value INTO v_url FROM private.trigger_config WHERE key = 'supabase_url';
  v_key := private.mips_service_key();
  v_secret := private.mips_webhook_secret();
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'mips_dispatch: missing url or service key, skipping %', p_fn;
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', v_key,
    'Authorization', 'Bearer ' || v_key,
    'x-system-call', 'db-webhook'
  );
  IF v_secret IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('x-sync-webhook-secret', v_secret);
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/' || p_fn,
    headers := v_headers,
    body := p_body,
    timeout_milliseconds := 8000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mips_dispatch(%) failed: %', p_fn, SQLERRM;
END;
$$;

-- Person-level webhook: photo/avatar -> sync-to-mips, dues/validity -> mips-access
CREATE OR REPLACE FUNCTION public.fn_mips_person_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_person_type text;
  v_photo_changed boolean := false;
  v_avatar_changed boolean := false;
  v_due_changed boolean := false;
  v_changed jsonb;
  v_revoke boolean := false;
BEGIN
  v_person_type := CASE TG_TABLE_NAME
    WHEN 'members' THEN 'member'
    WHEN 'employees' THEN 'employee'
    ELSE 'trainer' END;

  IF TG_OP = 'INSERT' THEN
    v_photo_changed := NEW.biometric_photo_path IS NOT NULL OR NEW.biometric_photo_url IS NOT NULL;
  ELSE
    v_photo_changed :=
      NEW.biometric_photo_path IS DISTINCT FROM OLD.biometric_photo_path
      OR NEW.mips_photo_hash IS DISTINCT FROM OLD.mips_photo_hash;
    v_avatar_changed :=
      NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url
      OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path;
  END IF;

  IF TG_TABLE_NAME = 'members' THEN
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.hardware_access_status IS DISTINCT FROM OLD.hardware_access_status
        OR NEW.hardware_access_enabled IS DISTINCT FROM OLD.hardware_access_enabled
        OR NEW.status IS DISTINCT FROM OLD.status;
      v_revoke := coalesce(NEW.hardware_access_enabled, true) = false
        OR coalesce(NEW.hardware_access_status, 'active') <> 'active'
        OR NEW.status::text <> 'active';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.exit_date IS DISTINCT FROM OLD.exit_date;
      v_revoke := coalesce(NEW.is_active, true) = false OR NEW.exit_date IS NOT NULL;
    END IF;
  END IF;

  IF NOT (v_photo_changed OR v_avatar_changed OR v_due_changed) THEN
    RETURN NEW;
  END IF;

  v_changed := jsonb_build_object(
    'photo_changed', v_photo_changed,
    'avatar_changed', v_avatar_changed,
    'due_changed', v_due_changed
  );

  -- Validity-only path: never re-uploads face data (keeps terminals stable)
  IF v_due_changed THEN
    IF TG_TABLE_NAME = 'members' THEN
      PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
        'action', CASE WHEN v_revoke THEN 'revoke' ELSE 'restore' END,
        'member_id', NEW.id,
        'branch_id', NEW.branch_id,
        'reason', 'DB webhook: access state changed',
        'person_type', v_person_type,
        'changed_fields', v_changed
      ));
    ELSE
      PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
        'action', CASE WHEN v_revoke THEN 'revoke_staff' ELSE 'restore_staff' END,
        'person_type', v_person_type,
        'person_id', NEW.id,
        'branch_id', NEW.branch_id,
        'reason', 'DB webhook: staff state changed',
        'changed_fields', v_changed
      ));
    END IF;
  END IF;

  -- Photo path: only when the image itself actually changed, and never for a
  -- photo the gates already rejected.
  IF (v_photo_changed OR v_avatar_changed)
     AND coalesce(NEW.mips_sync_status, '') NOT IN ('photo_rejected', 'revoked') THEN
    PERFORM private.mips_dispatch('sync-to-mips', jsonb_build_object(
      'person_type', v_person_type,
      'person_id', NEW.id,
      'branch_id', NEW.branch_id,
      'deploy_to_devices', true,
      'changed_fields', v_changed
    ));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_person_webhook failed for %.%: %', TG_TABLE_NAME, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mips_person_webhook ON public.members;
CREATE TRIGGER trg_mips_person_webhook
  AFTER INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.fn_mips_person_webhook();

DROP TRIGGER IF EXISTS trg_mips_person_webhook ON public.employees;
CREATE TRIGGER trg_mips_person_webhook
  AFTER INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.fn_mips_person_webhook();

DROP TRIGGER IF EXISTS trg_mips_person_webhook ON public.trainers;
CREATE TRIGGER trg_mips_person_webhook
  AFTER INSERT OR UPDATE ON public.trainers
  FOR EACH ROW EXECUTE FUNCTION public.fn_mips_person_webhook();

-- Profile avatar changes feed the person they belong to
CREATE OR REPLACE FUNCTION public.fn_mips_profile_avatar_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT 'member'::text AS pt, id, branch_id, mips_sync_status FROM public.members WHERE user_id = NEW.id
    UNION ALL
    SELECT 'employee', id, branch_id, mips_sync_status FROM public.employees WHERE user_id = NEW.id
    UNION ALL
    SELECT 'trainer', id, branch_id, mips_sync_status FROM public.trainers WHERE user_id = NEW.id
  LOOP
    CONTINUE WHEN coalesce(r.mips_sync_status, '') IN ('photo_rejected', 'revoked');
    PERFORM private.mips_dispatch('sync-to-mips', jsonb_build_object(
      'person_type', r.pt,
      'person_id', r.id,
      'branch_id', r.branch_id,
      'deploy_to_devices', true,
      'changed_fields', jsonb_build_object('photo_changed', false, 'avatar_changed', true, 'due_changed', false)
    ));
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_profile_avatar_webhook failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mips_profile_avatar_webhook ON public.profiles;
CREATE TRIGGER trg_mips_profile_avatar_webhook
  AFTER UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_mips_profile_avatar_webhook();

-- Membership validity changes (expiry / freeze / unfreeze / cancel / renewal)
CREATE OR REPLACE FUNCTION public.fn_mips_membership_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_branch uuid;
  v_revoke boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_branch FROM public.members WHERE id = NEW.member_id;
  v_revoke := NEW.status::text IN ('expired', 'cancelled', 'frozen') OR NEW.end_date < current_date;

  PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
    'action', CASE WHEN v_revoke THEN 'revoke' ELSE 'restore' END,
    'member_id', NEW.member_id,
    'branch_id', coalesce(NEW.branch_id, v_branch),
    'reason', 'DB webhook: membership ' || NEW.status::text,
    'changed_fields', jsonb_build_object('photo_changed', false, 'avatar_changed', false, 'due_changed', true)
  ));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_membership_webhook failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mips_membership_webhook ON public.memberships;
CREATE TRIGGER trg_mips_membership_webhook
  AFTER INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_mips_membership_webhook();