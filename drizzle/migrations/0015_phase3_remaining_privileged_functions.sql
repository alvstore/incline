-- ============================================================================
-- Phase 3: remaining privileged functions reachable by signed-in users
-- ============================================================================

-- A. Background / internal-only functions (no app caller; every DB caller is SECURITY DEFINER).
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'benefit_available_units','benefit_plan_remaining','channel_active_for_branch','consume_scan_credit_if_needed',
        'consume_coupon','current_branch','dr_dump_schema','dr_is_operational','enforce_branch_match',
        'generate_employee_code','generate_trainer_code','get_setting_numeric','has_active_benefit',
        'howbody_device_authorized','howbody_touch_device','is_bot_paused','is_dr_readonly','is_in_quiet_hours',
        'join_facility_waitlist','pick_next_nurture_angle','promote_announcement_to_campaign','quote_convenience_fee',
        'resolve_staff_shift','should_send_communication','staff_check_in',
        'tg_flag_payroll_attendance_change','tg_invoice_release_pt_commission'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;

-- B. Entry-point guards on write paths that previously only recorded who called them.
DO $do$
DECLARE
  g record;
  v_oid oid;
  v_def text;
  v_pos int;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
    ('purchase_pt_package', $g$  -- Phase 3 guard: the member themself (self-service) or branch staff/trainers
  IF public.rpc_guard_applies('purchase_pt_package') THEN
    IF NOT (public.is_own_member(_member_id) OR public.is_branch_staff(_branch_id, true)) THEN
      RAISE EXCEPTION 'forbidden: purchase_pt_package' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_branch_staff(_branch_id, true) THEN
      _received_by := NULL;
    END IF;
  END IF;$g$),
    ('purchase_group_membership', $g$  -- Phase 3 guard: branch staff only; the receiver is always the caller for non-admins
  IF public.rpc_guard_applies('purchase_group_membership') THEN
    PERFORM public.assert_branch_staff(p_branch_id, false, 'purchase_group_membership');
    IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
      p_received_by := auth.uid();
    END IF;
  END IF;$g$),
    ('transition_member_lifecycle', $g$  -- Phase 3 guard: staff who manage this member's branch
  IF public.rpc_guard_applies('transition_member_lifecycle') THEN
    IF NOT (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
            AND public.can_manage_member_lifecycle(auth.uid(), p_member_id)) THEN
      RAISE EXCEPTION 'forbidden: transition_member_lifecycle' USING ERRCODE = '42501';
    END IF;
  END IF;$g$),
    ('staff_record_punch', $g$  -- Phase 3 guard: a person may punch themself; otherwise branch staff
  IF public.rpc_guard_applies('staff_record_punch') THEN
    IF NOT (p_user_id = auth.uid() OR public.is_branch_staff(p_branch_id, false)) THEN
      RAISE EXCEPTION 'forbidden: staff_record_punch' USING ERRCODE = '42501';
    END IF;
  END IF;$g$),
    ('record_consent', $g$  -- Phase 3 guard: own profile, or staff of the lead's / member's branch
  IF public.rpc_guard_applies('record_consent') THEN
    IF NOT (
      (p_subject_type IN ('profile','member') AND p_subject_id = auth.uid())
      OR (p_subject_type = 'lead'
          AND public.is_branch_staff((SELECT l.branch_id FROM public.leads l WHERE l.id = p_subject_id), false))
      OR (p_subject_type IN ('profile','member')
          AND public.is_branch_staff((SELECT m.branch_id FROM public.members m WHERE m.user_id = p_subject_id LIMIT 1), false))
    ) THEN
      RAISE EXCEPTION 'forbidden: record_consent' USING ERRCODE = '42501';
    END IF;
  END IF;$g$),
    ('howbody_scan_quota', $g$  -- Phase 3 guard: the member themself, their trainer, or branch staff
  IF public.rpc_guard_applies('howbody_scan_quota') THEN
    IF NOT (public.is_own_member(_member_id)
            OR public.trainer_can_view_member(auth.uid(), _member_id)
            OR public.is_branch_staff((SELECT m.branch_id FROM public.members m WHERE m.id = _member_id), true)) THEN
      RAISE EXCEPTION 'forbidden: howbody_scan_quota' USING ERRCODE = '42501';
    END IF;
  END IF;$g$)
    ) AS t(fn_name, guard_sql)
  LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = g.fn_name
    ORDER BY p.pronargs DESC
    LIMIT 1;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Phase 3: function % not found', g.fn_name;
    END IF;
    v_def := pg_get_functiondef(v_oid);
    IF position('Phase 3 guard' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_pos := position(E'\nBEGIN\n' IN v_def);
    IF v_pos = 0 THEN
      RAISE EXCEPTION 'Phase 3: no BEGIN anchor in %', g.fn_name;
    END IF;
    v_def := left(v_def, v_pos + 6) || g.guard_sql || E'\n' || substr(v_def, v_pos + 7);
    EXECUTE v_def;
  END LOOP;
END
$do$;

-- C. Presence list is for staff, not members.
CREATE OR REPLACE FUNCTION public.get_online_users(stale_minutes integer DEFAULT 5)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, roles text[], last_seen_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF public.rpc_guard_applies('get_online_users')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: get_online_users' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.full_name,
    p.avatar_url,
    COALESCE(ARRAY(
      SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = p.id
    ), ARRAY[]::text[]) AS roles,
    p.last_seen_at
  FROM public.profiles p
  WHERE p.last_seen_at IS NOT NULL
    AND p.last_seen_at > now() - make_interval(mins => GREATEST(stale_minutes, 1))
    AND auth.uid() IS NOT NULL
  ORDER BY p.last_seen_at DESC
  LIMIT 200;
END;
$function$;

-- D. Permission predicates used by storage/table policies: when called directly,
--    a user may only ask about themself unless they hold a staff role.
CREATE OR REPLACE FUNCTION public.is_pure_trainer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('is_pure_trainer')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
      THEN public.forbid('is_pure_trainer')::boolean
    ELSE (
      EXISTS (SELECT 1 FROM public.user_roles t WHERE t.user_id = _user_id AND t.role = 'trainer')
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles a
        WHERE a.user_id = _user_id AND a.role IN ('owner','admin','manager','staff')
      )
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_write_member_measurements(_user_id uuid, _member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('can_write_member_measurements')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
      THEN public.forbid('can_write_member_measurements')::boolean
    ELSE public.can_access_member_measurements(_user_id, _member_id)
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_access_member_measurement_photo(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('can_access_member_measurement_photo')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
      THEN public.forbid('can_access_member_measurement_photo')::boolean
    WHEN public.extract_member_id_from_storage_path(_path) IS NULL THEN false
    ELSE public.can_access_member_measurements(_user_id, public.extract_member_id_from_storage_path(_path))
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_write_member_measurement_photo(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.rpc_guard_applies('can_write_member_measurement_photo')
         AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
      THEN public.forbid('can_write_member_measurement_photo')::boolean
    WHEN public.extract_member_id_from_storage_path(_path) IS NULL THEN false
    ELSE public.can_write_member_measurements(_user_id, public.extract_member_id_from_storage_path(_path))
  END
$function$;

-- Grants for guarded entry points: signed-in + service role, never anon.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'purchase_pt_package','purchase_group_membership','transition_member_lifecycle','staff_record_punch',
        'record_consent','howbody_scan_quota','get_online_users','is_pure_trainer','can_write_member_measurements',
        'can_access_member_measurement_photo','can_write_member_measurement_photo'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END
$do$;