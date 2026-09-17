-- 1. Quota: include complimentary gift sessions in availability
CREATE OR REPLACE FUNCTION public.howbody_scan_quota(_member_id uuid, _kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := CASE WHEN _kind = 'posture' THEN 'howbody_posture' ELSE '3d_body_scanning' END;
  v_enum public.benefit_type := CASE WHEN _kind = 'posture' THEN 'posture_scan'::public.benefit_type ELSE 'body_scan'::public.benefit_type END;
  v_branch uuid;
  v_benefit_type_id uuid;
  v_plan_id uuid;
  v_plan_limit int := 0;
  v_plan_freq text;
  v_used_this_period int := 0;
  v_used_this_month int := 0;
  v_addon_remaining int := 0;
  v_gift_remaining int := 0;
  v_period_start timestamptz;
  v_month_start timestamptz := date_trunc('month', now());
  v_plan_remaining int := 0;
BEGIN
  SELECT m.branch_id INTO v_branch FROM public.members m WHERE m.id = _member_id;

  SELECT mp.id INTO v_plan_id
  FROM public.memberships mb
  JOIN public.membership_plans mp ON mp.id = mb.plan_id
  WHERE mb.member_id = _member_id
    AND mb.status = 'active'
    AND mb.end_date >= CURRENT_DATE
  ORDER BY mb.end_date DESC
  LIMIT 1;

  -- Resolve the scan benefit type: exact code in branch, then any branch,
  -- then the shared "body composition & posture" service type.
  SELECT bt.id INTO v_benefit_type_id
    FROM public.benefit_types bt
   WHERE bt.code = v_code AND bt.branch_id = v_branch
   LIMIT 1;

  IF v_benefit_type_id IS NULL THEN
    SELECT bt.id INTO v_benefit_type_id
      FROM public.benefit_types bt
     WHERE bt.code = v_code
     LIMIT 1;
  END IF;

  IF v_benefit_type_id IS NULL THEN
    SELECT bt.id INTO v_benefit_type_id
      FROM public.benefit_types bt
     WHERE bt.code = '3d_body_scanning'
       AND (bt.branch_id = v_branch OR bt.branch_id IS NULL)
     ORDER BY (bt.branch_id = v_branch) DESC
     LIMIT 1;
  END IF;

  IF v_plan_id IS NOT NULL AND v_benefit_type_id IS NOT NULL THEN
    SELECT COALESCE(SUM(pb.limit_count), 0), MIN(pb.frequency)
      INTO v_plan_limit, v_plan_freq
      FROM public.plan_benefits pb
     WHERE pb.plan_id = v_plan_id
       AND pb.benefit_type_id = v_benefit_type_id;
  END IF;

  v_period_start := CASE
    WHEN v_plan_freq = 'monthly' THEN v_month_start
    WHEN v_plan_freq = 'weekly' THEN date_trunc('week', now())
    WHEN v_plan_freq = 'daily' THEN date_trunc('day', now())
    ELSE NULL
  END;

  -- Usage is counted from the idempotent consumption ledger (not raw report
  -- rows) so retries and companion reports never double-charge.
  SELECT COUNT(*) INTO v_used_this_period
    FROM public.howbody_scan_consumptions c
   WHERE c.member_id = _member_id
     AND c.kind = _kind
     AND c.source <> 'none'
     AND (v_period_start IS NULL OR c.created_at >= v_period_start);

  SELECT COUNT(*) INTO v_used_this_month
    FROM public.howbody_scan_consumptions c
   WHERE c.member_id = _member_id
     AND c.kind = _kind
     AND c.source <> 'none'
     AND c.created_at >= v_month_start;

  SELECT COALESCE(SUM(mbc.credits_remaining), 0) INTO v_addon_remaining
    FROM public.member_benefit_credits mbc
   WHERE mbc.member_id = _member_id
     AND mbc.credits_remaining > 0
     AND (mbc.expires_at IS NULL OR mbc.expires_at > now())
     AND (
       (v_benefit_type_id IS NOT NULL AND mbc.benefit_type_id = v_benefit_type_id)
       OR (mbc.benefit_type_id IS NULL AND mbc.benefit_type = v_enum)
     );

  IF v_benefit_type_id IS NOT NULL THEN
    SELECT COALESCE(SUM(GREATEST(mc.comp_sessions - mc.used_sessions, 0)), 0)
      INTO v_gift_remaining
      FROM public.member_comps mc
     WHERE mc.member_id = _member_id
       AND mc.benefit_type_id = v_benefit_type_id
       AND mc.used_sessions < mc.comp_sessions
       AND (mc.expires_at IS NULL OR mc.expires_at > now());
  END IF;

  v_plan_remaining := GREATEST(0, COALESCE(v_plan_limit,0) - v_used_this_period);

  RETURN jsonb_build_object(
    'kind', _kind,
    'benefit_code', v_code,
    'benefit_type_id', v_benefit_type_id,
    'plan_limit', COALESCE(v_plan_limit, 0),
    'plan_frequency', v_plan_freq,
    'used_this_period', v_used_this_period,
    'used_this_month', v_used_this_month,
    'plan_remaining', v_plan_remaining,
    'gift_remaining', v_gift_remaining,
    'addon_remaining', v_addon_remaining,
    'allowed', (v_plan_remaining > 0) OR (v_gift_remaining > 0) OR (v_addon_remaining > 0),
    'reason', CASE
      WHEN COALESCE(v_plan_limit,0) = 0 AND v_gift_remaining = 0 AND v_addon_remaining = 0 THEN 'plan_no_scan'
      WHEN v_plan_remaining = 0 AND v_gift_remaining = 0 AND v_addon_remaining = 0 THEN 'period_limit'
      ELSE 'ok'
    END
  );
END;
$function$;

-- 2. Consumption: plan -> gift -> credit, and write a real usage record
CREATE OR REPLACE FUNCTION public.howbody_consume_scan(_member_id uuid, _kind text, _data_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.howbody_scan_consumptions%ROWTYPE;
  v_companion public.howbody_scan_consumptions%ROWTYPE;
  v_quota jsonb;
  v_credit_id uuid;
  v_comp_id uuid;
  v_benefit_type_id uuid;
  v_membership_id uuid;
  v_code text := CASE WHEN _kind = 'posture' THEN 'howbody_posture' ELSE '3d_body_scanning' END;
  v_enum public.benefit_type := CASE WHEN _kind = 'posture' THEN 'posture_scan'::public.benefit_type ELSE 'body_scan'::public.benefit_type END;
  v_source text;
BEGIN
  IF _data_key IS NULL OR length(trim(_data_key)) = 0 THEN
    RAISE EXCEPTION 'data_key is required';
  END IF;

  SELECT * INTO v_existing
    FROM public.howbody_scan_consumptions
   WHERE data_key = _data_key
   FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object('consumed', false, 'duplicate', true, 'source', v_existing.source);
  END IF;

  -- Companion report from the same physical assessment (body + posture within
  -- 60 minutes) rides on the charge already taken; never bill it twice.
  SELECT * INTO v_companion
    FROM public.howbody_scan_consumptions c
   WHERE c.member_id = _member_id
     AND c.kind <> _kind
     AND c.source <> 'none'
     AND c.created_at > now() - interval '60 minutes'
   ORDER BY c.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.howbody_scan_consumptions (data_key, member_id, kind, source, credit_id)
    VALUES (_data_key, _member_id, _kind, 'companion', NULL)
    ON CONFLICT (data_key) DO NOTHING;

    RETURN jsonb_build_object('consumed', false, 'duplicate', false,
      'source', 'companion', 'companion_of', v_companion.data_key);
  END IF;

  v_quota := public.howbody_scan_quota(_member_id, _kind);
  v_benefit_type_id := NULLIF(v_quota->>'benefit_type_id','')::uuid;

  SELECT mb.id INTO v_membership_id
    FROM public.memberships mb
   WHERE mb.member_id = _member_id
     AND mb.status = 'active'
     AND mb.end_date >= CURRENT_DATE
   ORDER BY mb.end_date DESC
   LIMIT 1;

  IF COALESCE((v_quota->>'plan_remaining')::int, 0) > 0 THEN
    v_source := 'plan';
  ELSE
    -- Complimentary gift sessions come before anything the member paid for.
    IF v_benefit_type_id IS NOT NULL THEN
      SELECT mc.id INTO v_comp_id
        FROM public.member_comps mc
       WHERE mc.member_id = _member_id
         AND mc.benefit_type_id = v_benefit_type_id
         AND mc.used_sessions < mc.comp_sessions
         AND (mc.expires_at IS NULL OR mc.expires_at > now())
       ORDER BY COALESCE(mc.expires_at, 'infinity'::timestamptz) ASC, mc.created_at ASC
       LIMIT 1
       FOR UPDATE OF mc;
    END IF;

    IF v_comp_id IS NOT NULL THEN
      UPDATE public.member_comps
         SET used_sessions = used_sessions + 1
       WHERE id = v_comp_id;
      v_source := 'gift';
    ELSE
      SELECT mbc.id INTO v_credit_id
        FROM public.member_benefit_credits mbc
        LEFT JOIN public.benefit_types bt ON bt.id = mbc.benefit_type_id
       WHERE mbc.member_id = _member_id
         AND mbc.credits_remaining > 0
         AND (mbc.expires_at IS NULL OR mbc.expires_at > now())
         AND (
           bt.code = v_code
           OR (v_benefit_type_id IS NOT NULL AND mbc.benefit_type_id = v_benefit_type_id)
           OR (mbc.benefit_type_id IS NULL AND mbc.benefit_type = v_enum)
         )
       ORDER BY COALESCE(mbc.expires_at, 'infinity'::timestamptz) ASC, mbc.purchased_at ASC
       LIMIT 1
       FOR UPDATE OF mbc;

      IF v_credit_id IS NOT NULL THEN
        UPDATE public.member_benefit_credits
           SET credits_remaining = credits_remaining - 1,
               updated_at = now()
         WHERE id = v_credit_id;
        v_source := 'credit';
      ELSE
        v_source := 'none';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.howbody_scan_consumptions (data_key, member_id, kind, source, credit_id)
  VALUES (_data_key, _member_id, _kind, v_source, v_credit_id)
  ON CONFLICT (data_key) DO NOTHING;

  -- Authoritative usage record so the member profile and Benefit Tracking
  -- pages reflect the scan immediately.
  IF v_source <> 'none' AND v_membership_id IS NOT NULL THEN
    INSERT INTO public.benefit_usage (
      membership_id, benefit_type, benefit_type_id, usage_date, usage_time,
      usage_count, notes, source_meta
    ) VALUES (
      v_membership_id,
      COALESCE(v_enum, 'body_scan'::public.benefit_type),
      v_benefit_type_id,
      (now() AT TIME ZONE 'Asia/Kolkata')::date,
      (now() AT TIME ZONE 'Asia/Kolkata')::time,
      1,
      CASE WHEN _kind = 'posture' THEN 'HOWBODY posture scan' ELSE 'HOWBODY body composition scan' END,
      jsonb_build_object('source', 'howbody', 'kind', _kind, 'data_key', _data_key, 'charged_to', v_source)
    );
  END IF;

  RETURN jsonb_build_object('consumed', v_source <> 'none', 'duplicate', false,
    'source', v_source, 'credit_id', v_credit_id, 'comp_id', v_comp_id,
    'benefit_type_id', v_benefit_type_id);
END;
$function$;