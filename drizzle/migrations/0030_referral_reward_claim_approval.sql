ALTER TABLE public.referral_rewards
  ADD COLUMN IF NOT EXISTS claim_status text,
  ADD COLUMN IF NOT EXISTS claim_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_approval_id uuid,
  ADD COLUMN IF NOT EXISTS claim_review_note text;

-- Block direct wallet credit: rewards now land only through manager approval.
CREATE OR REPLACE FUNCTION public.claim_referral_reward(p_reward_id uuid, p_member_id uuid, p_idempotency_key text DEFAULT NULL::text, p_actor_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_reward public.referral_rewards%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_wallet_txn_id uuid;
  v_new_balance numeric;
BEGIN
  -- SEC_GUARD_APPROVAL_ONLY_V1: direct calls refused; only decide_referral_reward_claim / system may credit.
  IF public.rpc_guard_applies('claim_referral_reward') THEN
    RAISE EXCEPTION 'Referral rewards are added after branch manager approval' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reward FROM public.referral_rewards WHERE id = p_reward_id AND member_id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Reward not found'); END IF;
  IF v_reward.is_claimed THEN
    RETURN jsonb_build_object('success', true, 'reward_id', p_reward_id, 'claimed', true, 'idempotent', true, 'wallet_transaction_id', v_reward.claimed_wallet_txn_id);
  END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE member_id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (member_id, balance, total_credited, total_debited) VALUES (p_member_id, 0, 0, 0) RETURNING * INTO v_wallet;
  END IF;
  v_new_balance := COALESCE(v_wallet.balance, 0) + COALESCE(v_reward.reward_value, 0);
  INSERT INTO public.wallet_transactions (wallet_id, txn_type, amount, balance_after, description, reference_type, reference_id, created_by)
  VALUES (v_wallet.id, 'credit', COALESCE(v_reward.reward_value, 0), v_new_balance, COALESCE(v_reward.description, 'Referral reward claim'), 'referral_reward', p_reward_id, p_actor_user_id)
  RETURNING id INTO v_wallet_txn_id;
  UPDATE public.wallets SET balance = v_new_balance, total_credited = COALESCE(total_credited, 0) + COALESCE(v_reward.reward_value, 0), updated_at = now() WHERE id = v_wallet.id;
  UPDATE public.referral_rewards SET is_claimed = true, claimed_at = now(), claim_status = 'approved',
    claim_idempotency_key = COALESCE(p_idempotency_key, claim_idempotency_key), claimed_wallet_txn_id = v_wallet_txn_id
  WHERE id = p_reward_id;
  PERFORM public.advance_referral_lifecycle(v_reward.referral_id, 'claimed', p_actor_user_id, 'Referral reward claimed', 'reward_claim', p_idempotency_key, jsonb_build_object('wallet_transaction_id', v_wallet_txn_id));
  RETURN jsonb_build_object('success', true, 'reward_id', p_reward_id, 'wallet_transaction_id', v_wallet_txn_id, 'new_balance', v_new_balance);
END;
$function$;

-- Member (or staff on their behalf) asks to claim; creates a branch approval.
CREATE OR REPLACE FUNCTION public.request_referral_reward_claim(p_reward_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_reward public.referral_rewards%ROWTYPE;
  v_member record;
  v_approval_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_reward FROM public.referral_rewards WHERE id = p_reward_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Reward not found'); END IF;
  SELECT m.id, m.user_id, m.branch_id, m.member_code, p.full_name INTO v_member
  FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = v_reward.member_id;
  IF v_member.id IS NULL OR v_member.branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Member branch not found'); END IF;
  -- SEC_GUARD: own reward, or staff of that branch
  IF rpc_guard_applies('request_referral_reward_claim') AND v_member.user_id IS DISTINCT FROM auth.uid() THEN
    PERFORM public.assert_branch_staff(v_member.branch_id);
  END IF;
  IF v_reward.is_claimed THEN RETURN jsonb_build_object('success', false, 'error', 'Reward already added to wallet'); END IF;
  IF v_reward.claim_status = 'pending_approval' THEN RETURN jsonb_build_object('success', true, 'pending', true, 'approval_id', v_reward.claim_approval_id); END IF;
  IF EXISTS (SELECT 1 FROM public.referral_settings s WHERE s.branch_id = v_member.branch_id AND s.is_active = false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral rewards are paused at this branch');
  END IF;
  INSERT INTO public.approval_requests (branch_id, approval_type, reference_type, reference_id, requested_by, request_data)
  VALUES (v_member.branch_id, 'referral_reward', 'referral_reward', v_reward.id, auth.uid(),
    jsonb_build_object('memberName', v_member.full_name, 'memberCode', v_member.member_code, 'memberId', v_member.id,
      'rewardValue', v_reward.reward_value, 'description', v_reward.description, 'referralId', v_reward.referral_id))
  RETURNING id INTO v_approval_id;
  UPDATE public.referral_rewards SET claim_status = 'pending_approval', claim_requested_at = now(), claim_approval_id = v_approval_id, claim_review_note = NULL WHERE id = v_reward.id;
  RETURN jsonb_build_object('success', true, 'pending', true, 'approval_id', v_approval_id);
END;
$function$;

-- Branch manager / owner / admin decides; approval credits the wallet atomically.
CREATE OR REPLACE FUNCTION public.decide_referral_reward_claim(p_approval_id uuid, p_decision text, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.approval_requests%ROWTYPE;
  v_reward public.referral_rewards%ROWTYPE;
  v_res jsonb;
BEGIN
  IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v_req FROM public.approval_requests WHERE id = p_approval_id AND approval_type = 'referral_reward' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  -- SEC_GUARD: owner/admin, or manager of the request's branch; never your own request
  IF rpc_guard_applies('decide_referral_reward_claim') THEN
    IF NOT ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]))
            OR v_req.branch_id IN (SELECT public.managed_branch_ids(auth.uid()))) THEN
      RAISE EXCEPTION 'Only the branch manager can decide referral rewards' USING ERRCODE = '42501';
    END IF;
    IF v_req.requested_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own request' USING ERRCODE = '42501'; END IF;
  END IF;
  IF v_req.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'Request already decided'); END IF;
  SELECT * INTO v_reward FROM public.referral_rewards WHERE id = v_req.reference_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Reward not found'); END IF;
  IF p_decision = 'approve' THEN
    v_res := public.claim_referral_reward(v_reward.id, v_reward.member_id, 'approval-' || p_approval_id::text, auth.uid());
    IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RAISE EXCEPTION '%', COALESCE(v_res->>'error','Could not add reward'); END IF;
    UPDATE public.referral_rewards SET claim_review_note = p_note WHERE id = v_reward.id;
  ELSE
    UPDATE public.referral_rewards SET claim_status = 'rejected', claim_review_note = p_note WHERE id = v_reward.id;
  END IF;
  UPDATE public.approval_requests SET status = CASE WHEN p_decision='approve' THEN 'approved'::approval_status ELSE 'rejected'::approval_status END,
    reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_note, side_effects_committed_at = now(), updated_at = now()
  WHERE id = p_approval_id;
  RETURN jsonb_build_object('success', true, 'decision', p_decision, 'wallet', v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.request_referral_reward_claim(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_referral_reward_claim(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_referral_reward_claim(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_referral_reward_claim(uuid, text, text) TO authenticated, service_role;

-- Pause the automatic referral flow for now (setting stays editable).
UPDATE public.referral_settings SET is_active = false, updated_at = now() WHERE is_active = true;