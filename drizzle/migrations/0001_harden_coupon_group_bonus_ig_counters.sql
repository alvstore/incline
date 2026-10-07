REVOKE EXECUTE ON FUNCTION public.bump_ig_campaign_counters(uuid,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_ig_campaign_counters(uuid,integer,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_ig_campaign_counters(uuid,integer,integer,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_ig_campaign_counters(uuid,integer,integer,integer,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.award_group_bonus(p_group_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.member_groups%ROWTYPE; v_pct numeric; v_mult numeric := 1; v_member record;
  v_inv_total numeric; v_bonus int; v_total_awarded int := 0; v_rate numeric;
BEGIN
  IF NOT public.is_staff_or_system() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_group FROM public.member_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
  v_pct  := public.get_setting_numeric(v_group.branch_id, 'group_reward_bonus_pct', 5);
  IF v_group.group_type = 'couple' THEN
    v_mult := public.get_setting_numeric(v_group.branch_id, 'group_couple_multiplier', 1.5);
  END IF;
  v_rate := public.get_setting_numeric(v_group.branch_id, 'reward_points_per_rupee', 1);
  FOR v_member IN SELECT mgm.member_id FROM public.member_group_members mgm WHERE mgm.group_id = p_group_id LOOP
    SELECT COALESCE(SUM(i.total_amount), 0) INTO v_inv_total FROM public.invoices i
    WHERE i.member_id = v_member.member_id AND i.branch_id = v_group.branch_id
      AND i.notes ILIKE '%' || v_group.group_name || '%'
      AND i.created_at >= v_group.created_at - INTERVAL '5 minutes';
    v_bonus := FLOOR(v_inv_total * (v_pct/100.0) * v_mult * v_rate)::int;
    IF v_bonus <= 0 THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.rewards_ledger WHERE member_id = v_member.member_id
        AND reference_type = 'group_bonus' AND reference_id = p_group_id::text) THEN CONTINUE; END IF;
    INSERT INTO public.rewards_ledger (member_id, branch_id, points, reason, reference_type, reference_id)
    VALUES (v_member.member_id, v_group.branch_id, v_bonus,
      format('Group bonus (%s) — %s', v_group.group_type, v_group.group_name), 'group_bonus', p_group_id::text);
    v_total_awarded := v_total_awarded + v_bonus;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'group_id', p_group_id, 'total_points', v_total_awarded);
END $function$;
REVOKE EXECUTE ON FUNCTION public.award_group_bonus(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_group_bonus(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_coupon(p_code text, p_branch_id uuid, p_member_id uuid, p_subtotal numeric, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD; v_discount numeric; v_existing_id uuid; v_redemption_id uuid; v_reason text; v_replay jsonb;
BEGIN
  IF NOT public.is_staff_or_system() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT jsonb_build_object('success', true, 'redemption_id', id, 'discount_amount', discount_amount, 'code_id', discount_code_id, 'replayed', true)
      INTO v_replay FROM public.discount_redemptions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  END IF;
  SELECT * INTO c FROM public.discount_codes WHERE upper(code) = upper(p_code) FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.discount_redemption_attempts(code, member_id, branch_id, subtotal, reason, attempted_by)
      VALUES (p_code, p_member_id, p_branch_id, p_subtotal, 'not_found', auth.uid());
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;
  v_reason := NULL;
  IF NOT COALESCE(c.is_active,false) THEN v_reason := 'inactive';
  ELSIF c.valid_from IS NOT NULL AND now() < c.valid_from THEN v_reason := 'not_started';
  ELSIF c.valid_until IS NOT NULL AND now() > c.valid_until THEN v_reason := 'expired';
  ELSIF c.max_uses IS NOT NULL AND COALESCE(c.times_used,0) >= c.max_uses THEN v_reason := 'max_uses';
  ELSIF c.min_purchase IS NOT NULL AND p_subtotal < c.min_purchase THEN v_reason := 'min_purchase';
  ELSIF c.branch_id IS NOT NULL AND p_branch_id IS NOT NULL AND c.branch_id <> p_branch_id THEN v_reason := 'wrong_branch';
  END IF;
  IF v_reason IS NOT NULL THEN
    INSERT INTO public.discount_redemption_attempts(code, discount_code_id, member_id, branch_id, subtotal, reason, attempted_by)
      VALUES (p_code, c.id, p_member_id, p_branch_id, p_subtotal, v_reason, auth.uid());
    RETURN jsonb_build_object('success', false, 'reason', v_reason, 'code_id', c.id);
  END IF;
  IF c.discount_type = 'percentage' THEN
    v_discount := round(p_subtotal * COALESCE(c.discount_value,0) / 100.0, 2);
  ELSE
    v_discount := LEAST(COALESCE(c.discount_value,0), p_subtotal);
  END IF;
  v_discount := GREATEST(0, v_discount);
  UPDATE public.discount_codes SET times_used = COALESCE(times_used,0) + 1 WHERE id = c.id;
  INSERT INTO public.discount_redemptions(discount_code_id, code, member_id, branch_id, subtotal, discount_amount,
    reference_type, reference_id, idempotency_key, created_by)
  VALUES (c.id, c.code, p_member_id, p_branch_id, p_subtotal, v_discount,
    p_reference_type, p_reference_id, p_idempotency_key, auth.uid()) RETURNING id INTO v_redemption_id;
  RETURN jsonb_build_object('success', true, 'redemption_id', v_redemption_id, 'code_id', c.id, 'code', c.code,
    'discount_type', c.discount_type, 'discount_amount', v_discount,
    'remaining_uses', CASE WHEN c.max_uses IS NULL THEN NULL ELSE c.max_uses - COALESCE(c.times_used,0) - 1 END);
END $function$;
REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text,uuid,uuid,numeric,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_coupon(text,uuid,uuid,numeric,text,uuid,text) TO authenticated, service_role;