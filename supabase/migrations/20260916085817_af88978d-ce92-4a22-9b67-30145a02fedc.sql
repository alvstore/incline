-- 1. Staff gate check-out: staff_attendance keys on user_id, not employee_id
CREATE OR REPLACE FUNCTION public.staff_gate_check_out(_staff_id uuid, _branch_id uuid, _at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.staff_attendance%ROWTYPE;
  _floor timestamptz := _at - interval '18 hours';
BEGIN
  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE user_id = _staff_id
    AND check_out IS NULL
    AND check_in <= _at
    AND check_in >= _floor
    AND (_branch_id IS NULL OR branch_id IS NULL OR branch_id = _branch_id)
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF _at - _row.check_in < interval '1 minute' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
    END IF;

    UPDATE public.staff_attendance
    SET check_out = _at,
        total_hours = ROUND(EXTRACT(EPOCH FROM (_at - _row.check_in))/3600.0, 2)
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE user_id = _staff_id
    AND check_out IS NOT NULL
    AND check_in <= _at
    AND check_in >= _floor
    AND (_branch_id IS NULL OR branch_id IS NULL OR branch_id = _branch_id)
    AND _at - check_out <= interval '4 hours'
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND _at > _row.check_out THEN
    UPDATE public.staff_attendance
    SET check_out = _at,
        total_hours = ROUND(EXTRACT(EPOCH FROM (_at - _row.check_in))/3600.0, 2)
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id, 'extended', true,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'No open shift to close');
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- 2. Safe org config reader for every signed-in role (no webhook_slug / alert_config)
CREATE OR REPLACE FUNCTION public.get_org_config(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  branch_id uuid,
  name text,
  logo_url text,
  timezone text,
  currency text,
  fiscal_year_start text,
  website_theme jsonb,
  gst_rates jsonb,
  hsn_defaults jsonb,
  session_timeout_hours integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT os.id, os.branch_id, os.name, os.logo_url, os.timezone, os.currency,
         os.fiscal_year_start, os.website_theme, os.gst_rates, os.hsn_defaults,
         os.session_timeout_hours
  FROM public.organization_settings os
  WHERE auth.uid() IS NOT NULL
    AND (
      (_branch_id IS NULL AND os.branch_id IS NULL)
      OR (_branch_id IS NOT NULL AND os.branch_id = _branch_id)
    )
  ORDER BY os.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_org_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_config(uuid) TO authenticated, service_role;

-- 3. Lock down the gate-sync trigger functions (trigger execution is unaffected)
REVOKE ALL ON FUNCTION public.fn_mips_person_webhook() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mips_profile_avatar_webhook() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mips_membership_webhook() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.mips_dispatch(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.mips_service_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.mips_webhook_secret() FROM PUBLIC, anon, authenticated;

-- 4. Store the webhook shared secret used by the gate-sync triggers
INSERT INTO private.trigger_config (key, value)
VALUES ('sync_webhook_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- 5. A fresh face photo clears a previous rejection so the gate retries
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

  -- A genuinely NEW face photo clears a previous gate rejection so the person
  -- is retried; avatar-only changes never revive a rejected template.
  IF v_photo_changed AND coalesce(NEW.mips_sync_status, '') = 'photo_rejected' THEN
    EXECUTE format('UPDATE public.%I SET mips_sync_status = %L WHERE id = %L',
                   TG_TABLE_NAME, 'pending', NEW.id);
    NEW.mips_sync_status := 'pending';
  END IF;

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

REVOKE ALL ON FUNCTION public.fn_mips_person_webhook() FROM PUBLIC, anon, authenticated;

-- 6. Performance: the two hottest slow queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_branch_created
  ON public.whatsapp_messages (phone_number, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_logs_mips_record_id
  ON public.access_logs (((payload->>'mips_record_id')))
  WHERE payload->>'source' = 'mips_record_reconcile';