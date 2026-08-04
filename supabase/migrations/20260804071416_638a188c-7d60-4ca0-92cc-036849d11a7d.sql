CREATE OR REPLACE FUNCTION public.record_benefit_usage(
  p_membership_id uuid,
  p_member_id uuid,
  p_benefit_type public.benefit_type,
  p_benefit_type_id uuid DEFAULT NULL,
  p_usage_count integer DEFAULT 1,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_membership record;
  v_pb record;
  v_period_start date;
  v_used integer := 0;
  v_plan_remaining integer := 0;
  v_plan_unlimited boolean := false;
  v_need integer := GREATEST(COALESCE(p_usage_count, 1), 1);
  v_from_plan integer := 0;
  v_from_gift integer := 0;
  v_from_credit integer := 0;
  v_gift_avail integer := 0;
  v_credit_avail integer := 0;
  v_take integer;
  r record;
  v_sources text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'owner') OR public.has_role(v_uid, 'admin') OR
    public.has_role(v_uid, 'manager') OR public.has_role(v_uid, 'staff') OR
    public.has_role(v_uid, 'trainer')
  ) THEN
    RAISE EXCEPTION 'Not authorised to record benefit usage';
  END IF;

  SELECT m.id, m.member_id, m.plan_id, m.start_date
    INTO v_membership
  FROM public.memberships m
  WHERE m.id = p_membership_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership not found');
  END IF;

  -- ---------- 1. Plan allowance ----------
  SELECT pb.frequency, pb.limit_count
    INTO v_pb
  FROM public.plan_benefits pb
  WHERE pb.plan_id = v_membership.plan_id
    AND (
      (p_benefit_type_id IS NOT NULL AND pb.benefit_type_id = p_benefit_type_id)
      OR (p_benefit_type_id IS NULL AND pb.benefit_type_id IS NULL AND pb.benefit_type = p_benefit_type)
    )
  LIMIT 1;

  IF FOUND THEN
    IF v_pb.frequency = 'unlimited' OR v_pb.limit_count IS NULL THEN
      v_plan_unlimited := true;
    ELSE
      v_period_start := CASE v_pb.frequency
        WHEN 'daily' THEN CURRENT_DATE
        WHEN 'weekly' THEN (date_trunc('week', CURRENT_DATE))::date
        WHEN 'monthly' THEN (date_trunc('month', CURRENT_DATE))::date
        ELSE v_membership.start_date
      END;

      SELECT COALESCE(SUM(bu.usage_count), 0)
        INTO v_used
      FROM public.benefit_usage bu
      WHERE bu.membership_id = p_membership_id
        AND bu.usage_date >= v_period_start
        AND (
          (p_benefit_type_id IS NOT NULL AND bu.benefit_type_id = p_benefit_type_id)
          OR (p_benefit_type_id IS NULL AND bu.benefit_type = p_benefit_type)
        );

      v_plan_remaining := GREATEST(v_pb.limit_count - v_used, 0);
    END IF;
  END IF;

  IF v_plan_unlimited THEN
    v_from_plan := v_need;
    v_need := 0;
    v_sources := v_sources || 'plan';
  ELSIF v_plan_remaining > 0 THEN
    v_take := LEAST(v_plan_remaining, v_need);
    v_from_plan := v_take;
    v_need := v_need - v_take;
    v_sources := v_sources || 'plan';
  END IF;

  -- ---------- 2. Complimentary gifts ----------
  IF v_need > 0 AND p_benefit_type_id IS NOT NULL THEN
    SELECT COALESCE(SUM(GREATEST(mc.comp_sessions - mc.used_sessions, 0)), 0)
      INTO v_gift_avail
    FROM public.member_comps mc
    WHERE mc.member_id = p_member_id
      AND mc.benefit_type_id = p_benefit_type_id
      AND mc.used_sessions < mc.comp_sessions
      AND (mc.expires_at IS NULL OR mc.expires_at > now());
  END IF;

  -- ---------- 3. Purchased credits ----------
  IF v_need - LEAST(v_gift_avail, v_need) > 0 THEN
    SELECT COALESCE(SUM(c.credits_remaining), 0)
      INTO v_credit_avail
    FROM public.member_benefit_credits c
    WHERE c.member_id = p_member_id
      AND c.credits_remaining > 0
      AND c.expires_at > now()
      AND (
        (p_benefit_type_id IS NOT NULL AND c.benefit_type_id = p_benefit_type_id)
        OR (p_benefit_type_id IS NULL AND c.benefit_type = p_benefit_type)
      );
  END IF;

  IF v_need > v_gift_avail + v_credit_avail THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No sessions remaining for this benefit',
      'plan_remaining', v_plan_remaining,
      'gift_remaining', v_gift_avail,
      'credit_remaining', v_credit_avail
    );
  END IF;

  -- Deduct gifts (FIFO by expiry then creation)
  IF v_need > 0 AND p_benefit_type_id IS NOT NULL THEN
    FOR r IN
      SELECT mc.id, (mc.comp_sessions - mc.used_sessions) AS avail
      FROM public.member_comps mc
      WHERE mc.member_id = p_member_id
        AND mc.benefit_type_id = p_benefit_type_id
        AND mc.used_sessions < mc.comp_sessions
        AND (mc.expires_at IS NULL OR mc.expires_at > now())
      ORDER BY mc.expires_at NULLS LAST, mc.created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(r.avail, v_need);
      UPDATE public.member_comps
         SET used_sessions = used_sessions + v_take,
             updated_at = now()
       WHERE id = r.id;
      v_from_gift := v_from_gift + v_take;
      v_need := v_need - v_take;
    END LOOP;
    IF v_from_gift > 0 THEN
      v_sources := v_sources || 'gift';
    END IF;
  END IF;

  -- Deduct purchased credits
  IF v_need > 0 THEN
    FOR r IN
      SELECT c.id, c.credits_remaining AS avail
      FROM public.member_benefit_credits c
      WHERE c.member_id = p_member_id
        AND c.credits_remaining > 0
        AND c.expires_at > now()
        AND (
          (p_benefit_type_id IS NOT NULL AND c.benefit_type_id = p_benefit_type_id)
          OR (p_benefit_type_id IS NULL AND c.benefit_type = p_benefit_type)
        )
      ORDER BY c.expires_at, c.created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(r.avail, v_need);
      UPDATE public.member_benefit_credits
         SET credits_remaining = credits_remaining - v_take,
             updated_at = now()
       WHERE id = r.id;
      v_from_credit := v_from_credit + v_take;
      v_need := v_need - v_take;
    END LOOP;
    IF v_from_credit > 0 THEN
      v_sources := v_sources || 'purchased';
    END IF;
  END IF;

  IF v_need > 0 THEN
    RAISE EXCEPTION 'Insufficient benefit entitlement';
  END IF;

  INSERT INTO public.benefit_usage (
    membership_id, benefit_type, benefit_type_id, usage_date, usage_count, notes, recorded_by
  ) VALUES (
    p_membership_id,
    public.safe_benefit_enum(p_benefit_type::text)::public.benefit_type,
    p_benefit_type_id,
    CURRENT_DATE,
    GREATEST(COALESCE(p_usage_count, 1), 1),
    NULLIF(p_notes, ''),
    v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'sources', to_jsonb(v_sources),
    'from_plan', v_from_plan,
    'from_gift', v_from_gift,
    'from_credit', v_from_credit,
    'plan_remaining', CASE WHEN v_plan_unlimited THEN NULL ELSE GREATEST(v_plan_remaining - v_from_plan, 0) END,
    'gift_remaining', GREATEST(v_gift_avail - v_from_gift, 0),
    'credit_remaining', GREATEST(v_credit_avail - v_from_credit, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_benefit_usage(uuid, uuid, public.benefit_type, uuid, integer, text) TO authenticated;