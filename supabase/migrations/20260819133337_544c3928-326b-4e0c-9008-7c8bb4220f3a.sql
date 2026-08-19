-- MIPS Sync Hardening & Real-time Enforcement
-- v1.2.0 - Forced revocation and real-time dues gate improvement.

-- 1. Hardened Evaluate Function to always ensure requires_sync is set on status changes or force_sync
CREATE OR REPLACE FUNCTION public.evaluate_member_access_state(
  p_member_id uuid,
  p_actor_user_id uuid DEFAULT auth.uid(),
  p_reason text DEFAULT NULL,
  p_force_sync boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_member public.members%ROWTYPE;
  v_branch_settings public.branch_settings%ROWTYPE;
  v_has_active_membership boolean := false;
  v_has_frozen_membership boolean := false;
  v_has_overdue boolean := false;
  v_new_status text := 'none';
  v_previous_status text;
  v_requires_sync boolean := false;
BEGIN
  SELECT * INTO v_member
  FROM public.members
  WHERE id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Member not found');
  END IF;

  SELECT * INTO v_branch_settings
  FROM public.branch_settings
  WHERE branch_id = v_member.branch_id;

  -- 1. Check active membership
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships ms
    WHERE ms.member_id = p_member_id
      AND ms.status = 'active'::public.membership_status
      AND ms.start_date <= current_date
      AND ms.end_date >= current_date
  ) INTO v_has_active_membership;

  -- 2. Check frozen membership
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships ms
    WHERE ms.member_id = p_member_id
      AND ms.status = 'frozen'::public.membership_status
      AND ms.start_date <= current_date
      AND COALESCE(ms.end_date, current_date) >= current_date
  ) INTO v_has_frozen_membership;

  -- 3. Check overdue invoices (using the canonical member_access_status logic)
  v_has_overdue := (public.member_access_status(p_member_id, v_member.branch_id) ->> 'allowed')::boolean IS FALSE;

  v_previous_status := COALESCE(v_member.hardware_access_status, 'none');

  -- Logic priority: Suspension > Frozen > Overdue > Active > Expired
  IF v_member.status IN ('suspended'::public.member_status, 'blacklisted'::public.member_status) THEN
    v_new_status := 'blocked_member_status';
  ELSIF v_has_frozen_membership THEN
    v_new_status := 'frozen';
  ELSIF COALESCE(v_branch_settings.block_access_on_overdue, true) AND v_has_overdue THEN
    v_new_status := 'blocked_overdue';
  ELSIF v_has_active_membership THEN
    v_new_status := 'active';
  ELSE
    v_new_status := 'expired';
  END IF;

  -- We trigger sync if status changed OR if force_sync is requested (to fix middleware drift)
  IF v_new_status <> v_previous_status OR p_force_sync THEN
    v_requires_sync := true;
  END IF;

  UPDATE public.members
  SET hardware_access_status = v_new_status,
      hardware_access_reason = CASE 
        WHEN v_new_status = 'blocked_overdue' THEN 'dues' 
        WHEN v_new_status = 'frozen' THEN 'frozen'
        WHEN v_new_status = 'expired' THEN 'expired'
        WHEN v_new_status = 'blocked_member_status' THEN 'manual'
        ELSE NULL 
      END,
      updated_at = now()
  WHERE id = p_member_id;

  IF v_requires_sync THEN
    INSERT INTO public.hardware_access_events (
      branch_id, member_id, actor_user_id, previous_status, new_status, reason, requires_sync
    ) VALUES (
      v_member.branch_id, p_member_id, p_actor_user_id, v_previous_status, v_new_status, p_reason, true
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 
    'previous_status', v_previous_status, 
    'new_status', v_new_status, 
    'synced', v_requires_sync
  );
END;
$$;

-- 2. Add an explicit RPC to force-reconcile MIPS for a specific member
CREATE OR REPLACE FUNCTION public.force_mips_reconcile(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.evaluate_member_access_state(_member_id, auth.uid(), 'Manual force sync', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_mips_reconcile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_mips_reconcile(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_member_access_state(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_member_access_state(uuid, uuid, text, boolean) TO service_role;
