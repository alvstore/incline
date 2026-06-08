-- Fix: /register self-onboarding inserts lifecycle_state='pending_plan' but the
-- CHECK constraint did not allow it, causing every self-registration to fail
-- with 23514. Add 'pending_plan' to the allowed set and teach the lifecycle
-- state machine the valid transitions out of it.

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_lifecycle_state_check;
ALTER TABLE public.members ADD CONSTRAINT members_lifecycle_state_check
CHECK (lifecycle_state = ANY (ARRAY[
  'created'::text,
  'pending_verification'::text,
  'verified'::text,
  'pending_plan'::text,
  'active'::text,
  'onboarded'::text,
  'suspended'::text,
  'archived'::text
]));

CREATE OR REPLACE FUNCTION public.transition_member_lifecycle(p_member_id uuid, p_to_state text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current text;
  v_allowed boolean := false;
BEGIN
  SELECT lifecycle_state INTO v_current FROM public.members
   WHERE id = p_member_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Member % not found', p_member_id USING ERRCODE = 'P0002';
  END IF;

  -- Allowed transitions
  v_allowed := CASE
    WHEN v_current = 'created' AND p_to_state IN ('pending_verification','verified','pending_plan','active','archived') THEN true
    WHEN v_current = 'pending_verification' AND p_to_state IN ('verified','pending_plan','active','archived') THEN true
    WHEN v_current = 'verified' AND p_to_state IN ('pending_plan','active','suspended','archived') THEN true
    WHEN v_current = 'pending_plan' AND p_to_state IN ('active','archived','suspended') THEN true
    WHEN v_current = 'active' AND p_to_state IN ('suspended','archived') THEN true
    WHEN v_current = 'suspended' AND p_to_state IN ('active','archived') THEN true
    WHEN v_current = 'archived' AND p_to_state IN ('active') THEN true  -- restore
    WHEN v_current = p_to_state THEN true                               -- no-op
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid transition % → %', v_current, p_to_state
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current <> p_to_state THEN
    UPDATE public.members
       SET lifecycle_state = p_to_state, updated_at = now()
     WHERE id = p_member_id;

    INSERT INTO public.member_lifecycle_transitions
      (member_id, from_state, to_state, actor_id, reason)
    VALUES (p_member_id, v_current, p_to_state, auth.uid(), p_reason);
  END IF;

  RETURN jsonb_build_object(
    'member_id', p_member_id,
    'from_state', v_current,
    'to_state', p_to_state
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';