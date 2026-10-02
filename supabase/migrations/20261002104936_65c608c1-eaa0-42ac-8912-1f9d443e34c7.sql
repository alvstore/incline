-- Gifts live only in member_comps; stop mirroring them into member_benefit_credits (caused double counting).
CREATE OR REPLACE FUNCTION public.grant_member_comp(p_member_id uuid, p_benefit_type_id uuid, p_sessions integer, p_reason text, p_notes text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT 'direct'::text, p_approval_request_id uuid DEFAULT NULL::uuid, p_membership_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_granted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid := p_branch_id;
  v_actor  uuid := COALESCE(p_granted_by, auth.uid());
  v_new_id uuid;
  v_bt_name text;
  v_member_name text;
  v_membership_id uuid := p_membership_id;
  v_expires timestamptz := p_expires_at;
BEGIN
  IF p_sessions IS NULL OR p_sessions <= 0 THEN RAISE EXCEPTION 'sessions must be positive'; END IF;
  IF p_source NOT IN ('direct','approval') THEN RAISE EXCEPTION 'source must be direct or approval'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role]) THEN
    RAISE EXCEPTION 'Not authorized to grant comps';
  END IF;
  IF v_branch IS NULL THEN SELECT branch_id INTO v_branch FROM public.members WHERE id = p_member_id; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Could not resolve branch for member %', p_member_id; END IF;

  IF v_membership_id IS NULL THEN
    SELECT id INTO v_membership_id FROM public.memberships
     WHERE member_id = p_member_id
       AND status IN ('active'::public.membership_status,'pending'::public.membership_status,'frozen'::public.membership_status)
     ORDER BY end_date DESC LIMIT 1;
  END IF;
  IF v_expires IS NULL AND v_membership_id IS NOT NULL THEN
    SELECT (end_date + 1)::timestamptz INTO v_expires FROM public.memberships WHERE id = v_membership_id;
  END IF;

  INSERT INTO public.member_comps
    (member_id, membership_id, benefit_type_id, comp_sessions, used_sessions,
     reason, notes, expires_at, source, approval_request_id, branch_id, granted_by)
  VALUES
    (p_member_id, v_membership_id, p_benefit_type_id, p_sessions, 0,
     COALESCE(p_reason,'Complimentary'), p_notes, v_expires,
     p_source, p_approval_request_id, v_branch, v_actor)
  RETURNING id INTO v_new_id;

  SELECT name INTO v_bt_name FROM public.benefit_types WHERE id = p_benefit_type_id;
  SELECT COALESCE(p.full_name, m.member_code) INTO v_member_name
    FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = p_member_id;

  RETURN jsonb_build_object('success', true, 'comp_id', v_new_id, 'credit_id', NULL,
    'branch_id', v_branch, 'member_name', v_member_name, 'benefit_name', v_bt_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.amend_member_comp(p_comp_id uuid, p_new_sessions integer, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_comp public.member_comps%ROWTYPE;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: minimum 4 characters' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_sessions IS NULL OR p_new_sessions < 0 THEN RAISE EXCEPTION 'INVALID_SESSIONS' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_comp FROM public.member_comps WHERE id = p_comp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_new_sessions < COALESCE(v_comp.used_sessions,0) THEN
    RAISE EXCEPTION 'ALREADY_USED: % session(s) already consumed on this gift', v_comp.used_sessions USING ERRCODE = 'P0001';
  END IF;

  IF p_new_sessions = 0 THEN
    DELETE FROM public.member_comps WHERE id = p_comp_id;
  ELSE
    UPDATE public.member_comps
       SET comp_sessions = p_new_sessions,
           notes = COALESCE(notes,'') || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
                   || 'Amended to ' || p_new_sessions || ': ' || btrim(p_reason),
           updated_at = now()
     WHERE id = p_comp_id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_comp.branch_id, v_uid,
      CASE WHEN p_new_sessions = 0 THEN 'comp_revoked' ELSE 'comp_amended' END,
      'member_comps', p_comp_id,
      jsonb_build_object('comp_sessions', v_comp.comp_sessions, 'used_sessions', v_comp.used_sessions),
      jsonb_build_object('comp_sessions', p_new_sessions, 'reason', btrim(p_reason)));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'comp_id', p_comp_id, 'comp_sessions', p_new_sessions, 'revoked', p_new_sessions = 0);
END;
$function$;

-- Cleanup existing mirror rows: carry any usage over to the gift, fill gift expiry, then remove the duplicate.
WITH pairs AS (
  SELECT DISTINCT ON (c.id) c.id AS credit_id, mc.id AS comp_id,
         (c.credits_total - c.credits_remaining) AS credit_used, c.expires_at
    FROM public.member_benefit_credits c
    JOIN public.member_comps mc
      ON mc.member_id = c.member_id AND mc.benefit_type_id = c.benefit_type_id
     AND c.credits_total = mc.comp_sessions
     AND abs(extract(epoch FROM (c.created_at - mc.created_at))) < 10
   WHERE c.package_id IS NULL AND c.invoice_id IS NULL
   ORDER BY c.id, abs(extract(epoch FROM (c.created_at - mc.created_at)))
), upd AS (
  UPDATE public.member_comps mc
     SET used_sessions = LEAST(mc.comp_sessions, GREATEST(mc.used_sessions, p.credit_used)),
         expires_at = COALESCE(mc.expires_at, p.expires_at),
         updated_at = now()
    FROM pairs p WHERE mc.id = p.comp_id
  RETURNING p.credit_id
)
DELETE FROM public.member_benefit_credits WHERE id IN (SELECT credit_id FROM upd);