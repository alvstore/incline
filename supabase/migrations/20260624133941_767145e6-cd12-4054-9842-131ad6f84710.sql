-- Fix convert_lead_to_member: only write columns that exist on members
CREATE OR REPLACE FUNCTION public.convert_lead_to_member(
  p_lead_id uuid,
  p_branch_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_existing_member_id uuid;
  v_member_id uuid;
  v_caller uuid := auth.uid();
  v_member_code text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF NOT (public.has_role(v_caller,'owner') OR public.has_role(v_caller,'admin')
       OR public.has_role(v_caller,'manager') OR public.has_role(v_caller,'staff')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_not_found');
  END IF;

  -- Refuse unusable leads
  IF v_lead.status = 'lost' THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_lost');
  END IF;
  IF COALESCE(v_lead.do_not_contact, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'do_not_contact');
  END IF;

  -- Idempotency by key
  IF p_idempotency_key IS NOT NULL THEN
    SELECT converted_member_id INTO v_existing_member_id
      FROM public.leads
     WHERE conversion_idempotency_key = p_idempotency_key
       AND converted_member_id IS NOT NULL
     LIMIT 1;
    IF v_existing_member_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'member_id', v_existing_member_id, 'idempotent_hit', true);
    END IF;
  END IF;

  -- Idempotency: already converted
  IF v_lead.converted_member_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'member_id', v_lead.converted_member_id,
                              'idempotent_hit', true, 'reason', 'lead_already_converted');
  END IF;

  -- Insert ONLY columns that exist on public.members.
  -- PII (name/phone/email/dob/gender) stays on leads and is reachable via members.lead_id.
  INSERT INTO public.members (
    branch_id, lead_id, source, status, user_id
  ) VALUES (
    p_branch_id,
    p_lead_id,
    COALESCE(v_lead.source, 'lead_conversion'),
    'active',
    NULL
  )
  RETURNING id, member_code INTO v_member_id, v_member_code;

  UPDATE public.leads
     SET status = 'converted',
         converted_at = now(),
         won_at = COALESCE(won_at, now()),
         converted_member_id = v_member_id,
         conversion_idempotency_key = COALESCE(conversion_idempotency_key, p_idempotency_key)
   WHERE id = p_lead_id;

  INSERT INTO public.lead_activities (lead_id, branch_id, actor_id, activity_type, title, metadata)
  VALUES (p_lead_id, p_branch_id, v_caller, 'conversion', 'Converted to member',
          jsonb_build_object('member_id', v_member_id, 'member_code', v_member_code));

  INSERT INTO public.audit_logs (
    branch_id, user_id, action, table_name, record_id, new_data, action_description
  ) VALUES (
    p_branch_id, v_caller, 'INSERT', 'members', v_member_id,
    jsonb_build_object('lead_id', p_lead_id, 'member_id', v_member_id),
    'Lead converted to member (RPC)'
  );

  RETURN jsonb_build_object(
    'success', true,
    'member_id', v_member_id,
    'member_code', v_member_code,
    'idempotent_hit', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.convert_lead_to_member(uuid, uuid, text, jsonb) TO authenticated;

-- Prevent double-conversion at DB layer (race-safe)
CREATE UNIQUE INDEX IF NOT EXISTS members_lead_id_uniq
  ON public.members(lead_id)
  WHERE lead_id IS NOT NULL;

-- Backfill: any lead marked converted but with no member_id (stuck from the broken RPC) → reset
UPDATE public.leads
   SET status = 'qualified',
       converted_at = NULL,
       won_at = NULL,
       conversion_idempotency_key = NULL
 WHERE status = 'converted'
   AND converted_member_id IS NULL;
