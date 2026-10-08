-- ============================================================================
-- Phase 1b: entry-point authorization for app-called SECURITY DEFINER RPCs
-- ----------------------------------------------------------------------------
-- Pattern: every guarded function checks public.rpc_guard_applies('<name>').
--   * true  -> the signed-in user called THIS function directly over the Data
--              API (request.path = '/rpc/<name>') -> enforce authorization.
--   * false -> service-role / cron / trigger context, or the function was
--              reached from another RPC (whose own entry-point guard applies).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_service_request()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           NULLIF(current_setting('request.jwt.claim.role', true), ''),
           'none'
         ) IN ('service_role', 'none');
$$;
REVOKE ALL ON FUNCTION public.is_service_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_request() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_guard_applies(p_fn text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_service_request() THEN false
    WHEN pg_trigger_depth() > 0 THEN false
    WHEN current_setting('request.path', true) IS NULL THEN true
    ELSE current_setting('request.path', true) = '/rpc/' || p_fn
  END;
$$;
REVOKE ALL ON FUNCTION public.rpc_guard_applies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_guard_applies(text) TO anon, authenticated, service_role;

-- Branch-scoped staff check (owner/admin anywhere; manager/staff - and
-- optionally trainers - only inside their own branches). Offboarded staff
-- never pass.
CREATE OR REPLACE FUNCTION public.is_branch_staff(p_branch_id uuid, p_include_trainers boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT public.is_staff_offboarded(auth.uid())
     AND (
       public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
       OR (
         p_branch_id IS NOT NULL
         AND (
           public.has_any_role(auth.uid(), ARRAY['manager','staff']::public.app_role[])
           OR (p_include_trainers AND public.has_role(auth.uid(), 'trainer'::public.app_role))
         )
         AND (
           p_branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
           OR public.manages_branch(auth.uid(), p_branch_id)
           OR p_branch_id = public.staff_primary_branch(auth.uid())
           OR p_branch_id = public.get_user_branch(auth.uid())
         )
       )
     );
$$;
REVOKE ALL ON FUNCTION public.is_branch_staff(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_branch_staff(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_branch_staff(p_branch_id uuid, p_include_trainers boolean DEFAULT false, p_action text DEFAULT 'this action')
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_branch_staff(p_branch_id, p_include_trainers) THEN
    RAISE EXCEPTION 'forbidden: % requires staff access to this branch', p_action USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_branch_staff(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_branch_staff(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_own_member(p_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_own_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_own_member(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Inject entry-point guards into the existing plpgsql bodies (idempotent: a
-- function already carrying a 'Phase 1b guard' marker is skipped).
-- ----------------------------------------------------------------------------
DO $do$
DECLARE
  g record;
  v_oid oid;
  v_def text;
  v_pos int;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
    ('check_trainer_slot_available', NULL, $g$  -- Phase 1b guard: trainer themself, branch staff/trainers, or a member with an active PT package with this trainer
  IF public.rpc_guard_applies('check_trainer_slot_available') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = _trainer_id
        AND (
          t.user_id = auth.uid()
          OR public.is_branch_staff(t.branch_id, true)
          OR EXISTS (
            SELECT 1 FROM public.member_pt_packages mpp
            JOIN public.members m ON m.id = mpp.member_id
            WHERE mpp.trainer_id = t.id AND m.user_id = auth.uid()
              AND mpp.status::text = 'active'
          )
        )
    ) THEN
      RAISE EXCEPTION 'forbidden: check_trainer_slot_available' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('convert_proforma_to_invoice', NULL, $g$  -- Phase 1b guard: branch staff only (owner/admin anywhere)
  IF public.rpc_guard_applies('convert_proforma_to_invoice') THEN
    PERFORM public.assert_branch_staff(
      (SELECT i.branch_id FROM public.invoices i WHERE i.id = _invoice_id),
      false, 'convert_proforma_to_invoice');
  END IF;$g$, $d$$d$),
    ('ensure_facility_slots', NULL, $g$  -- Phase 1b guard: staff/trainers of the branch (<=120 day window);
  -- members of the branch may only prepare the near-term window they can book.
  IF public.rpc_guard_applies('ensure_facility_slots') THEN
    IF p_branch_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RAISE EXCEPTION 'invalid slot window' USING ERRCODE = '22023';
    END IF;
    IF public.is_branch_staff(p_branch_id, true) THEN
      IF (p_end_date - p_start_date) > 120 THEN
        RAISE EXCEPTION 'slot window too large (max 120 days)' USING ERRCODE = '22023';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid()
        AND (m.branch_id = p_branch_id
             OR EXISTS (SELECT 1 FROM public.memberships ms
                        WHERE ms.member_id = m.id AND ms.branch_id = p_branch_id
                          AND ms.status IN ('active'::public.membership_status, 'frozen'::public.membership_status)))
    ) THEN
      IF p_start_date < (CURRENT_DATE - 1) OR p_end_date > (CURRENT_DATE + 45) THEN
        RAISE EXCEPTION 'members can only prepare slots up to 45 days ahead' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'forbidden: ensure_facility_slots' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('evaluate_member_access_state', NULL, $g$  -- Phase 1b guard: only branch staff may re-evaluate a member's gate access; actor is always the caller
  IF public.rpc_guard_applies('evaluate_member_access_state') THEN
    PERFORM public.assert_branch_staff(
      (SELECT m.branch_id FROM public.members m WHERE m.id = p_member_id),
      false, 'evaluate_member_access_state');
    p_actor_user_id := auth.uid();
  END IF;$g$, $d$$d$),
    ('get_inactive_members', NULL, $g$  -- Phase 1b guard: branch staff only (member PII)
  IF public.rpc_guard_applies('get_inactive_members') THEN
    PERFORM public.assert_branch_staff(p_branch_id, false, 'get_inactive_members');
  END IF;$g$, $d$$d$),
    ('get_upcoming_birthdays', NULL, $g$  -- Phase 1b guard: branch staff only; NULL branch (all branches) is owner/admin only
  IF public.rpc_guard_applies('get_upcoming_birthdays') THEN
    PERFORM public.assert_branch_staff(p_branch_id, false, 'get_upcoming_birthdays');
  END IF;$g$, $d$$d$),
    ('mark_class_attendance', NULL, $g$  -- Phase 1b guard: class-session managers of the class's branch; pure trainers only for their own classes
  IF public.rpc_guard_applies('mark_class_attendance') THEN
    SELECT c.branch_id, c.trainer_id INTO v_guard_branch, v_guard_trainer
    FROM public.class_bookings cb
    JOIN public.classes c ON c.id = cb.class_id
    WHERE cb.id = _booking_id;
    IF v_guard_branch IS NULL OR NOT public.can_manage_class_session(v_guard_branch) THEN
      RAISE EXCEPTION 'forbidden: mark_class_attendance' USING ERRCODE = '42501';
    END IF;
    IF public.is_pure_trainer(auth.uid()) AND NOT EXISTS (
      SELECT 1 FROM public.trainers t WHERE t.id = v_guard_trainer AND t.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'forbidden: trainers can only mark attendance for their own classes' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$  v_guard_branch uuid;
  v_guard_trainer uuid;$d$),
    ('member_check_in', NULL, $g$  -- Phase 1b guard: branch staff and trainers only
  IF public.rpc_guard_applies('member_check_in') THEN
    PERFORM public.assert_branch_staff(_branch_id, true, 'member_check_in');
  END IF;$g$, $d$$d$),
    ('member_check_out', NULL, $g$  -- Phase 1b guard: branch staff and trainers of the branch of the open visit (or the member's home branch)
  IF public.rpc_guard_applies('member_check_out') THEN
    PERFORM public.assert_branch_staff(
      COALESCE(
        (SELECT ma.branch_id FROM public.member_attendance ma
          WHERE ma.member_id = _member_id AND ma.check_out IS NULL
          ORDER BY ma.check_in DESC LIMIT 1),
        (SELECT m.branch_id FROM public.members m WHERE m.id = _member_id)
      ), true, 'member_check_out');
  END IF;$g$, $d$$d$),
    ('member_force_check_in', NULL, $g$  -- Phase 1b guard: branch staff only; actor is always the caller
  IF public.rpc_guard_applies('member_force_check_in') THEN
    PERFORM public.assert_branch_staff(p_branch_id, false, 'member_force_check_in');
    p_actor_user_id := auth.uid();
  END IF;$g$, $d$$d$),
    ('recheck_invoice_reconciliation', NULL, $g$  -- Phase 1b guard: finance viewers of the invoice's branch
  IF public.rpc_guard_applies('recheck_invoice_reconciliation') THEN
    IF NOT (public.has_capability(auth.uid(), 'view_financials')
            AND public.is_branch_staff((SELECT i.branch_id FROM public.invoices i WHERE i.id = p_invoice_id), false)) THEN
      RAISE EXCEPTION 'forbidden: recheck_invoice_reconciliation' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('resolve_campaign_audience', NULL, $g$  -- Phase 1b guard: owner/admin, or manager of the branch (audience contains contact data)
  IF public.rpc_guard_applies('resolve_campaign_audience') THEN
    IF NOT (public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
            OR (public.has_role(auth.uid(), 'manager'::public.app_role) AND public.is_branch_staff(p_branch_id, false))) THEN
      RAISE EXCEPTION 'forbidden: resolve_campaign_audience' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('resolve_campaign_audience_v2', NULL, $g$  -- Phase 1b guard: owner/admin, or manager of the branch (audience contains contact data)
  IF public.rpc_guard_applies('resolve_campaign_audience_v2') THEN
    IF NOT (public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
            OR (public.has_role(auth.uid(), 'manager'::public.app_role) AND public.is_branch_staff(p_branch_id, false))) THEN
      RAISE EXCEPTION 'forbidden: resolve_campaign_audience_v2' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('set_handoff', 4, $g$  -- Phase 1b guard: branch staff only (NULL branch = owner/admin); assignee must be a staff user
  IF public.rpc_guard_applies('set_handoff') THEN
    PERFORM public.assert_branch_staff(_branch_id, false, 'set_handoff');
  END IF;
  IF v_assigned IS NOT NULL AND NOT public.has_any_role(v_assigned, ARRAY['owner','admin','manager','staff']::public.app_role[]) THEN
    RAISE EXCEPTION 'handoff assignee must be a staff user' USING ERRCODE = '22023';
  END IF;$g$, $d$$d$),
    ('staff_day_blocks', NULL, $g$  -- Phase 1b guard: own schedule, or branch staff of that person's branch
  IF public.rpc_guard_applies('staff_day_blocks') THEN
    IF NOT (p_user_id = auth.uid()
            OR public.is_branch_staff(public.staff_primary_branch(p_user_id), false)) THEN
      RAISE EXCEPTION 'forbidden: staff_day_blocks' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('validate_class_booking', NULL, $g$  -- Phase 1b guard: the member themself, or a class-session manager of the class's branch
  IF public.rpc_guard_applies('validate_class_booking') THEN
    IF NOT (public.is_own_member(_member_id)
            OR public.can_manage_class_session((SELECT c.branch_id FROM public.classes c WHERE c.id = _class_id))) THEN
      RAISE EXCEPTION 'forbidden: validate_class_booking' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$),
    ('validate_coupon', NULL, $g$  -- Phase 1b guard: signed-in members and staff only; members must validate against their own branch
  IF public.rpc_guard_applies('validate_coupon') THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'forbidden: validate_coupon' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_branch_staff(p_branch_id, true) THEN
      IF p_branch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.members m WHERE m.user_id = auth.uid() AND m.branch_id = p_branch_id
      ) THEN
        RAISE EXCEPTION 'forbidden: validate_coupon' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;$g$, $d$$d$),
    ('validate_member_checkin', NULL, $g$  -- Phase 1b guard: the member themself, or branch staff/trainers
  IF public.rpc_guard_applies('validate_member_checkin') THEN
    IF NOT (public.is_own_member(_member_id) OR public.is_branch_staff(_branch_id, true)) THEN
      RAISE EXCEPTION 'forbidden: validate_member_checkin' USING ERRCODE = '42501';
    END IF;
  END IF;$g$, $d$$d$)
    ) AS t(fn_name, fn_nargs, guard_sql, decl_sql)
  LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = g.fn_name
      AND (g.fn_nargs IS NULL OR p.pronargs = g.fn_nargs)
    ORDER BY p.pronargs DESC
    LIMIT 1;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Phase 1b: function % not found', g.fn_name;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF position('Phase 1b guard' IN v_def) > 0 THEN
      CONTINUE;
    END IF;

    v_pos := position(E'\nBEGIN\n' IN v_def);
    IF v_pos = 0 THEN
      RAISE EXCEPTION 'Phase 1b: no BEGIN anchor in %', g.fn_name;
    END IF;
    v_def := left(v_def, v_pos + 6) || g.guard_sql || E'\n' || substr(v_def, v_pos + 7);

    IF length(g.decl_sql) > 0 THEN
      v_pos := position(E'\nDECLARE\n' IN v_def);
      IF v_pos = 0 THEN
        RAISE EXCEPTION 'Phase 1b: no DECLARE anchor in %', g.fn_name;
      END IF;
      v_def := left(v_def, v_pos + 8) || g.decl_sql || E'\n' || substr(v_def, v_pos + 9);
    END IF;

    EXECUTE v_def;
  END LOOP;
END
$do$;

CREATE OR REPLACE FUNCTION public.is_staff_offboarded(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 1b guard: a user may ask about themself; otherwise staff roles only
  IF public.rpc_guard_applies('is_staff_offboarded')
     AND NOT (_user_id = auth.uid()
              OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])) THEN
    RAISE EXCEPTION 'forbidden: is_staff_offboarded' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.trainers t
    WHERE t.user_id = _user_id AND t.is_active = false AND t.exit_date IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = _user_id AND e.is_active = false AND e.exit_date IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pending_advance_for_user(_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 1b guard: own balance, or finance viewers of that employee's branch
  IF public.rpc_guard_applies('pending_advance_for_user')
     AND NOT (_user_id = auth.uid()
              OR (public.has_capability(auth.uid(), 'view_financials')
                  AND public.is_branch_staff(public.staff_primary_branch(_user_id), false))) THEN
    RAISE EXCEPTION 'forbidden: pending_advance_for_user' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(SUM(outstanding), 0)
    FROM public.salary_advances
    WHERE user_id = _user_id AND status = 'outstanding' AND auto_recover = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.workout_schedule_offset_load(_branch_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(offset_days smallint, active_plans bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 1b guard: branch staff/trainers; NULL branch (all branches) is owner/admin only
  IF public.rpc_guard_applies('workout_schedule_offset_load') THEN
    PERFORM public.assert_branch_staff(_branch_id, true, 'workout_schedule_offset_load');
  END IF;
  RETURN QUERY
  SELECT g.offset_days::smallint,
         COUNT(p.id)::bigint AS active_plans
  FROM generate_series(0, 6) AS g(offset_days)
  LEFT JOIN public.member_fitness_plans p
    ON p.schedule_offset_days = g.offset_days
   AND p.plan_type = 'workout'
   AND (p.valid_until IS NULL OR p.valid_until >= CURRENT_DATE)
   AND (_branch_id IS NULL OR p.branch_id = _branch_id)
  GROUP BY g.offset_days
  ORDER BY g.offset_days;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_common_plans(p_member_id uuid, p_type text)
RETURNS TABLE(template_id uuid, name text, description text, goal text, difficulty text, duration_weeks integer, days_per_week integer, target_goal text, target_gender text, target_age_min integer, target_age_max integer, match_score integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 1b guard: the member themself, their lifecycle managers, or their assigned trainer
  IF public.rpc_guard_applies('match_common_plans')
     AND NOT (public.can_manage_member_lifecycle(auth.uid(), p_member_id)
              OR public.trainer_can_view_member(auth.uid(), p_member_id)) THEN
    RAISE EXCEPTION 'forbidden: match_common_plans' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH m AS (
    SELECT
      lower(coalesce(p.gender::text, '')) AS gender,
      CASE WHEN p.date_of_birth IS NULL THEN NULL
           ELSE date_part('year', age(p.date_of_birth))::int END AS age,
      lm.weight_kg,
      lm.height_cm,
      CASE
        WHEN lm.weight_kg IS NULL OR lm.height_cm IS NULL OR lm.height_cm = 0 THEN NULL
        ELSE round( (lm.weight_kg / power(lm.height_cm/100.0, 2))::numeric, 1)
      END AS bmi,
      mb.fitness_goals,
      lower(coalesce(mb.fitness_level,'')) AS fitness_level
    FROM public.members mb
    LEFT JOIN public.profiles p ON p.id = mb.user_id
    LEFT JOIN LATERAL (
      SELECT mm.weight_kg, mm.height_cm
        FROM public.member_measurements mm
       WHERE mm.member_id = mb.id
       ORDER BY mm.created_at DESC
       LIMIT 1
    ) lm ON true
    WHERE mb.id = p_member_id
  )
  SELECT
    t.id,
    t.name,
    t.description,
    t.goal,
    t.difficulty,
    t.duration_weeks,
    t.days_per_week,
    t.target_goal,
    t.target_gender,
    t.target_age_min,
    t.target_age_max,
    (
        CASE WHEN t.target_gender = 'any' OR t.target_gender = m.gender THEN 30 ELSE 0 END
      + CASE
          WHEN m.age IS NULL THEN 5
          WHEN (t.target_age_min IS NULL OR m.age >= t.target_age_min)
           AND (t.target_age_max IS NULL OR m.age <= t.target_age_max) THEN 25
          ELSE 0
        END
      + CASE
          WHEN t.target_weight_min_kg IS NULL AND t.target_weight_max_kg IS NULL
           AND t.target_bmi_min IS NULL AND t.target_bmi_max IS NULL THEN 10
          WHEN m.weight_kg IS NOT NULL
           AND (t.target_weight_min_kg IS NULL OR m.weight_kg >= t.target_weight_min_kg)
           AND (t.target_weight_max_kg IS NULL OR m.weight_kg <= t.target_weight_max_kg) THEN 20
          WHEN m.bmi IS NOT NULL
           AND (t.target_bmi_min IS NULL OR m.bmi >= t.target_bmi_min)
           AND (t.target_bmi_max IS NULL OR m.bmi <= t.target_bmi_max) THEN 20
          ELSE 0
        END
      + CASE
          WHEN t.target_goal IS NULL THEN 5
          WHEN m.fitness_goals IS NULL THEN 5
          WHEN lower(t.target_goal) = ANY (string_to_array(lower(m.fitness_goals), ',')) THEN 15
          WHEN position(lower(t.target_goal) in lower(m.fitness_goals)) > 0 THEN 8
          ELSE 0
        END
      + CASE
          WHEN coalesce(array_length(t.target_experience,1),0) = 0 THEN 5
          WHEN m.fitness_level = ANY (t.target_experience) THEN 10
          ELSE 0
        END
    )::int AS match_score
  FROM public.fitness_plan_templates t
  CROSS JOIN m
  WHERE t.is_common = true
    AND t.is_active = true
    AND t.type = p_type
  ORDER BY match_score DESC, t.created_at DESC
  LIMIT 5;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employer_profile(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 1b guard: employer legal/HR profile is for staff and trainers only
  IF public.rpc_guard_applies('get_employer_profile')
     AND NOT (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
              AND NOT public.is_staff_offboarded(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden: get_employer_profile' USING ERRCODE = '42501';
  END IF;
  RETURN (
  WITH b AS (
    SELECT * FROM public.branches WHERE id = _branch_id
  ),
  o AS (
    SELECT * FROM public.organization_settings
    WHERE branch_id = _branch_id
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  ),
  o_global AS (
    SELECT * FROM public.organization_settings
    WHERE branch_id IS NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  ),
  h AS (
    SELECT * FROM public.hr_settings WHERE branch_id = _branch_id
    UNION ALL
    SELECT * FROM public.hr_settings WHERE branch_id IS NULL
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'branch_id',                   _branch_id,
    'legal_name',                  COALESCE((SELECT name FROM b), (SELECT name FROM o_global), 'Incline'),
    'brand_name',                  COALESCE((SELECT name FROM o), (SELECT name FROM o_global), (SELECT name FROM b)),
    'address_line',                (SELECT address FROM b),
    'city',                        (SELECT city FROM b),
    'state',                       (SELECT state FROM b),
    'postal_code',                 (SELECT postal_code FROM b),
    'country',                     COALESCE((SELECT country FROM b), 'India'),
    'full_address', NULLIF(
      concat_ws(', ',
        NULLIF((SELECT address FROM b), ''),
        NULLIF((SELECT city FROM b), ''),
        NULLIF((SELECT state FROM b), ''),
        NULLIF((SELECT postal_code FROM b), ''),
        COALESCE(NULLIF((SELECT country FROM b), ''), 'India')
      ),
    ''),
    'gstin',                       (SELECT gstin FROM b),
    'phone',                       (SELECT phone FROM b),
    'email',                       (SELECT email FROM b),
    'logo_url',                    COALESCE((SELECT logo_url FROM o), (SELECT logo_url FROM o_global)),
    'pan',                         (SELECT employer_pan FROM h),
    'proprietor_name',             (SELECT employer_proprietor_name FROM h),
    'firm_registration_no',        (SELECT employer_firm_registration_no FROM h),
    'arbitration_seat',            (SELECT arbitration_seat FROM h),
    'governing_jurisdiction',      (SELECT governing_jurisdiction FROM h),
    'posh_ic',                     (SELECT posh_ic FROM h),
    'notice_period_staff_days',    (SELECT notice_period_staff_days FROM h),
    'notice_period_trainer_days',  (SELECT notice_period_trainer_days FROM h),
    'notice_period_manager_days',  (SELECT notice_period_manager_days FROM h),
    'basic_pct_of_ctc',            (SELECT basic_pct_of_ctc FROM h),
    'ot_multiplier',               (SELECT ot_multiplier FROM h),
    'daily_hour_cap',              (SELECT daily_hour_cap FROM h),
    'weekly_hour_cap',             (SELECT weekly_hour_cap FROM h)
  )
  );
END;
$function$;

-- Legacy 3-arg set_handoff: not used by the app; fix the broken profiles join and make it service-only.
CREATE OR REPLACE FUNCTION public.set_handoff(_phone text, _reason text DEFAULT 'AI handoff requested'::text, _urgency text DEFAULT 'medium'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
  v_member_id uuid;
  v_lead_id uuid;
BEGIN
  IF public.rpc_guard_applies('set_handoff') THEN
    PERFORM public.assert_branch_staff(NULL, false, 'set_handoff');
  END IF;

  UPDATE public.whatsapp_chat_settings
  SET bot_active = false, updated_at = now()
  WHERE phone_number = _phone;

  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_chat_settings (phone_number, bot_active, created_at, updated_at)
    VALUES (_phone, false, now(), now())
    ON CONFLICT (phone_number) DO UPDATE SET bot_active = false, updated_at = now();
  END IF;

  SELECT m.id, m.branch_id INTO v_member_id, v_branch
  FROM public.members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE p.phone = _phone
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.members SET bot_active = false WHERE id = v_member_id;
  END IF;

  SELECT id, branch_id INTO v_lead_id, v_branch
  FROM public.leads
  WHERE phone = _phone
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads SET bot_active = false WHERE id = v_lead_id;
  END IF;

  INSERT INTO public.notifications (user_id, branch_id, title, message, type, category, action_url, metadata)
  SELECT
    ur.user_id,
    v_branch,
    'AI Handoff Requested',
    COALESCE(_reason, 'A conversation needs human attention'),
    CASE WHEN _urgency = 'high' THEN 'warning' ELSE 'info' END,
    'whatsapp',
    '/whatsapp-chat?phone=' || _phone,
    jsonb_build_object('phone', _phone, 'reason', _reason, 'urgency', _urgency, 'source', 'ai_handoff')
  FROM public.user_roles ur
  WHERE ur.role IN ('owner','admin','manager','staff');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.set_handoff(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_handoff(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.set_handoff(text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_handoff(text, text, uuid, uuid) TO authenticated, service_role;

-- Grants: these entry points are for signed-in users (plus service role); never anon.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'check_trainer_slot_available','convert_proforma_to_invoice','ensure_facility_slots',
        'evaluate_member_access_state','get_employer_profile','get_inactive_members','get_upcoming_birthdays',
        'is_staff_offboarded','mark_class_attendance','match_common_plans','member_check_in','member_check_out',
        'member_force_check_in','pending_advance_for_user','recheck_invoice_reconciliation',
        'resolve_campaign_audience','resolve_campaign_audience_v2','staff_day_blocks','validate_class_booking',
        'validate_coupon','validate_member_checkin','workout_schedule_offset_load'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END
$do$;