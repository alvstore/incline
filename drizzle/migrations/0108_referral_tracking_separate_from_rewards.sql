ALTER TABLE public.referral_settings ADD COLUMN IF NOT EXISTS tracking_enabled boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.referral_settings.is_active IS 'Reward payouts on/off. Referral tracking is controlled by tracking_enabled.';

CREATE OR REPLACE FUNCTION public.get_referral_enabled(p_branch_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  -- guard-exempt: returns only a boolean branch toggle (tracking), no personal data
  SELECT COALESCE((SELECT tracking_enabled OR is_active FROM public.referral_settings WHERE branch_id = p_branch_id ORDER BY updated_at DESC NULLS LAST LIMIT 1), true);
$function$;

CREATE OR REPLACE FUNCTION public.get_referral_rewards_enabled(p_branch_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  -- guard-exempt: returns only a boolean branch toggle, no personal data
  SELECT COALESCE((SELECT is_active FROM public.referral_settings WHERE branch_id = p_branch_id ORDER BY updated_at DESC NULLS LAST LIMIT 1), false);
$function$;
REVOKE ALL ON FUNCTION public.get_referral_rewards_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_rewards_enabled(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_referral_reward(p_referral_id uuid, p_invoice_id uuid, p_actor_user_id uuid DEFAULT auth.uid(), p_source text DEFAULT 'payment_settlement'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_existing_reward uuid;
  v_reward_value numeric := 0;
  v_reward_id uuid;
  v_branch uuid;
BEGIN
  SELECT * INTO v_referral FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Referral not found'); END IF;

  SELECT branch_id INTO v_branch FROM public.members WHERE id = v_referral.referrer_member_id;
  IF NOT public.get_referral_rewards_enabled(v_branch) THEN
    -- Tracking continues; payouts are paused for this branch.
    RETURN jsonb_build_object('success', true, 'rewards_paused', true);
  END IF;

  SELECT id INTO v_existing_reward FROM public.referral_rewards WHERE referral_id = p_referral_id LIMIT 1;
  IF v_existing_reward IS NOT NULL THEN
    PERFORM public.advance_referral_lifecycle(p_referral_id, 'rewarded', p_actor_user_id, 'Reward already exists', p_source, p_idempotency_key, jsonb_build_object('invoice_id', p_invoice_id));
    RETURN jsonb_build_object('success', true, 'reward_id', v_existing_reward, 'idempotent', true);
  END IF;

  SELECT COALESCE(rr.reward_amount, 0) INTO v_reward_value
  FROM public.referral_reward_rules rr WHERE rr.is_active = true ORDER BY rr.created_at DESC LIMIT 1;
  IF v_reward_value IS NULL OR v_reward_value <= 0 THEN v_reward_value := 0; END IF;

  INSERT INTO public.referral_rewards (referral_id, member_id, reward_type, reward_value, description)
  VALUES (p_referral_id, v_referral.referrer_member_id, 'wallet_credit', v_reward_value, 'Referral conversion reward')
  RETURNING id INTO v_reward_id;

  PERFORM public.advance_referral_lifecycle(p_referral_id, 'rewarded', p_actor_user_id, 'Referral reward issued', p_source, p_idempotency_key, jsonb_build_object('invoice_id', p_invoice_id, 'reward_id', v_reward_id));
  RETURN jsonb_build_object('success', true, 'reward_id', v_reward_id, 'reward_value', v_reward_value);
END;
$function$;