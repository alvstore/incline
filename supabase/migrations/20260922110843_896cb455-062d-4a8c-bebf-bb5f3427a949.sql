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
  v_new_person boolean := false;
  v_changed jsonb;
  v_revoke boolean := false;
BEGIN
  v_person_type := CASE TG_TABLE_NAME
    WHEN 'members' THEN 'member'
    WHEN 'employees' THEN 'employee'
    ELSE 'trainer' END;

  IF TG_OP = 'INSERT' THEN
    v_photo_changed := NEW.biometric_photo_path IS NOT NULL;
    v_new_person := true;
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
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.exit_date IS DISTINCT FROM OLD.exit_date;
      v_revoke := coalesce(NEW.is_active, true) = false OR NEW.exit_date IS NOT NULL;
    END IF;
  END IF;

  IF NOT (v_photo_changed OR v_due_changed OR v_new_person) THEN
    RETURN NEW;
  END IF;

  v_changed := jsonb_build_object(
    'photo_changed', v_photo_changed,
    'avatar_changed', v_avatar_changed,
    'due_changed', v_due_changed,
    'new_person', v_new_person
  );

  IF v_due_changed THEN
    IF TG_TABLE_NAME = 'members' THEN
      PERFORM private.mips_enqueue_member_access(NEW.id, NEW.branch_id, 'DB webhook: access state changed');
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

  IF v_photo_changed AND coalesce(NEW.mips_sync_status, '') = 'photo_rejected' THEN
    EXECUTE format('UPDATE public.%I SET mips_sync_status = %L WHERE id = %L',
                   TG_TABLE_NAME, 'pending', NEW.id);
    NEW.mips_sync_status := 'pending';
  END IF;

  -- Provision on the gate server for every brand-new person, and re-push
  -- whenever the biometric photo changes.
  IF (v_photo_changed OR v_new_person)
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