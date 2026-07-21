
-- ============================================================
-- 1. Fix generic audit trigger — resolve branch_id defensively
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_log_trigger_function()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch       uuid;
  v_record_pk    uuid;
  v_uid          uuid;
  v_actor_name   text;
  v_actor_source text;
  v_action_desc  text;
  v_old_data     jsonb;
  v_new_data     jsonb;
  v_table_label  text;
  v_headers      jsonb;
  v_header_id    text;
  v_header_name  text;
  v_fallback_row public.members%ROWTYPE;
  v_member_id    uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    BEGIN v_uid := NULLIF(current_setting('app.actor_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF v_uid IS NULL THEN
    BEGIN
      v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
      v_header_id := v_headers ->> 'x-actor-id';
      IF v_header_id IS NOT NULL AND v_header_id <> '' THEN
        v_uid := v_header_id::uuid;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  BEGIN v_actor_name := NULLIF(current_setting('app.actor_name', true), '');
  EXCEPTION WHEN OTHERS THEN v_actor_name := NULL; END;

  IF v_actor_name IS NULL THEN
    BEGIN
      IF v_headers IS NULL THEN
        v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
      END IF;
      v_header_name := v_headers ->> 'x-actor-name';
      IF v_header_name IS NOT NULL AND v_header_name <> '' THEN
        v_actor_name := v_header_name;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF v_actor_name IS NULL AND v_uid IS NOT NULL THEN
    BEGIN SELECT NULLIF(full_name, '') INTO v_actor_name FROM public.profiles WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF v_actor_name IS NULL AND v_uid IS NOT NULL THEN
    BEGIN SELECT email INTO v_actor_name FROM auth.users WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF v_actor_name IS NULL THEN
    BEGIN v_actor_source := NULLIF(current_setting('app.actor_source', true), '');
    EXCEPTION WHEN OTHERS THEN v_actor_source := NULL; END;
    IF v_actor_source IS NULL THEN
      BEGIN
        IF v_headers IS NULL THEN
          v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
        END IF;
        v_actor_source := v_headers ->> 'x-actor-source';
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    v_actor_name := CASE
      WHEN v_actor_source IS NOT NULL AND v_actor_source <> ''
        THEN 'System (' || v_actor_source || ')'
      ELSE 'System'
    END;
  END IF;

  -- Snapshots, pk. Resolve branch_id defensively — table may not have the column.
  IF TG_OP = 'INSERT' THEN
    v_old_data := NULL;
    v_new_data := to_jsonb(NEW);
    BEGIN v_branch := (v_new_data ->> 'branch_id')::uuid;
    EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    v_record_pk := (v_new_data ->> 'id')::uuid;
    v_member_id := NULLIF(v_new_data ->> 'member_id','')::uuid;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    BEGIN v_branch := COALESCE((v_new_data ->> 'branch_id')::uuid, (v_old_data ->> 'branch_id')::uuid);
    EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    v_record_pk := COALESCE((v_new_data ->> 'id')::uuid, (v_old_data ->> 'id')::uuid);
    v_member_id := COALESCE(NULLIF(v_new_data ->> 'member_id','')::uuid, NULLIF(v_old_data ->> 'member_id','')::uuid);
  ELSE
    v_old_data := to_jsonb(OLD);
    v_new_data := NULL;
    BEGIN v_branch := (v_old_data ->> 'branch_id')::uuid;
    EXCEPTION WHEN OTHERS THEN v_branch := NULL; END;
    v_record_pk := (v_old_data ->> 'id')::uuid;
    v_member_id := NULLIF(v_old_data ->> 'member_id','')::uuid;
  END IF;

  -- Fallback: derive branch from member when the row itself has no branch_id column.
  IF v_branch IS NULL AND v_member_id IS NOT NULL THEN
    BEGIN
      SELECT branch_id INTO v_branch FROM public.members WHERE id = v_member_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  v_table_label := replace(TG_TABLE_NAME, '_', ' ');
  v_action_desc := CASE TG_OP
    WHEN 'INSERT' THEN 'Created ' || v_table_label || ' row'
    WHEN 'UPDATE' THEN 'Updated ' || v_table_label || ' row'
    WHEN 'DELETE' THEN 'Deleted ' || v_table_label || ' row'
    ELSE TG_OP || ' ' || v_table_label
  END;

  INSERT INTO public.audit_logs (
    action, table_name, record_id,
    old_data, new_data,
    user_id, branch_id,
    actor_name, action_description
  ) VALUES (
    TG_OP, TG_TABLE_NAME, v_record_pk,
    v_old_data, v_new_data,
    v_uid, v_branch,
    v_actor_name, v_action_desc
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- ============================================================
-- 2. Extend member_comps for a real audit trail
-- ============================================================
ALTER TABLE public.member_comps
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_comps_source_chk') THEN
    ALTER TABLE public.member_comps ADD CONSTRAINT member_comps_source_chk
      CHECK (source IN ('direct','approval'));
  END IF;
END $$;

-- Backfill branch_id from members
UPDATE public.member_comps mc
SET branch_id = m.branch_id
FROM public.members m
WHERE mc.member_id = m.id AND mc.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_comps_member_branch ON public.member_comps(member_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_member_comps_branch_created ON public.member_comps(branch_id, created_at DESC);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_member_comps_updated_at ON public.member_comps;
CREATE TRIGGER trg_member_comps_updated_at
BEFORE UPDATE ON public.member_comps
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. Atomic grant_member_comp RPC (single source of truth)
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_member_comp(
  p_member_id uuid,
  p_benefit_type_id uuid,
  p_sessions int,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_source text DEFAULT 'direct',
  p_approval_request_id uuid DEFAULT NULL,
  p_membership_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_granted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch uuid := p_branch_id;
  v_actor  uuid := COALESCE(p_granted_by, auth.uid());
  v_new_id uuid;
  v_bt_name text;
  v_member_name text;
BEGIN
  IF p_sessions IS NULL OR p_sessions <= 0 THEN
    RAISE EXCEPTION 'sessions must be positive';
  END IF;
  IF p_source NOT IN ('direct','approval') THEN
    RAISE EXCEPTION 'source must be direct or approval';
  END IF;

  -- Authorize: caller must be staff+ (or invoked via approval SECURITY DEFINER path with p_granted_by set)
  IF auth.uid() IS NOT NULL AND NOT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role]) THEN
    RAISE EXCEPTION 'Not authorized to grant comps';
  END IF;

  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch FROM public.members WHERE id = p_member_id;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Could not resolve branch for member %', p_member_id;
  END IF;

  INSERT INTO public.member_comps
    (member_id, membership_id, benefit_type_id, comp_sessions, used_sessions,
     reason, notes, expires_at, source, approval_request_id, branch_id, granted_by)
  VALUES
    (p_member_id, p_membership_id, p_benefit_type_id, p_sessions, 0,
     COALESCE(p_reason,'Complimentary'), p_notes, p_expires_at,
     p_source, p_approval_request_id, v_branch, v_actor)
  RETURNING id INTO v_new_id;

  SELECT name INTO v_bt_name FROM public.benefit_types WHERE id = p_benefit_type_id;
  SELECT COALESCE(p.full_name, m.member_code)
    INTO v_member_name
    FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.id = p_member_id;

  RETURN jsonb_build_object(
    'success', true,
    'comp_id', v_new_id,
    'branch_id', v_branch,
    'member_name', v_member_name,
    'benefit_name', v_bt_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_member_comp(uuid,uuid,int,text,text,timestamptz,text,uuid,uuid,uuid,uuid) TO authenticated, service_role;

-- ============================================================
-- 4. Route comp_gift approvals through grant_member_comp
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_approval_request(p_request_id uuid, p_decision text, p_review_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _req         public.approval_requests%ROWTYPE;
  _data        jsonb;
  _membership_id uuid;
  _to_member_id uuid;
  _to_branch_id uuid;
  _ms          public.memberships%ROWTYPE;
  _frozen_days int;
  _today       date := CURRENT_DATE;
  _err         text;
  _new_membership_id uuid;
  _invoice_id  uuid;
  _audit_payload jsonb;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role]) THEN
    RAISE EXCEPTION 'Not authorized to process approvals';
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'p_decision must be approve or reject';
  END IF;

  SELECT * INTO _req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF _req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already ' || _req.status);
  END IF;
  IF NOT manages_branch(auth.uid(), _req.branch_id) THEN
    RAISE EXCEPTION 'Not authorized for this branch';
  END IF;

  _data := _req.request_data;

  IF p_decision = 'reject' THEN
    UPDATE public.approval_requests
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_review_notes
    WHERE id = p_request_id;
    IF _req.approval_type = 'membership_freeze' AND _req.reference_type <> 'membership_unfreeze' THEN
      UPDATE public.membership_freeze_history SET status = 'rejected' WHERE id = _req.reference_id;
    END IF;
    INSERT INTO public.approval_audit_log(request_id, action, actor_id, success, payload)
    VALUES (p_request_id, 'rejected', auth.uid(), true, jsonb_build_object('notes', p_review_notes));
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  _membership_id := COALESCE((_data->>'membershipId')::uuid, (_data->>'membership_id')::uuid);
  _to_member_id  := (_data->>'to_member_id')::uuid;
  _to_branch_id  := (_data->>'to_branch_id')::uuid;
  _audit_payload := _data;

  BEGIN
    IF _req.approval_type = 'membership_freeze' AND _req.reference_type <> 'membership_unfreeze' THEN
      UPDATE public.membership_freeze_history
      SET status = 'approved', approved_by = auth.uid(), approved_at = now()
      WHERE id = _req.reference_id;
      IF _membership_id IS NOT NULL THEN
        UPDATE public.memberships SET status = 'frozen' WHERE id = _membership_id;
      END IF;

    ELSIF _req.reference_type = 'membership_unfreeze' THEN
      IF _membership_id IS NOT NULL THEN
        SELECT * INTO _ms FROM public.memberships WHERE id = _membership_id FOR UPDATE;
        IF FOUND THEN
          SELECT COALESCE(SUM(GREATEST(0, (COALESCE(end_date, _today) - start_date)::int)), 0)
          INTO _frozen_days
          FROM public.membership_freeze_history
          WHERE membership_id = _membership_id AND status = 'approved';
          UPDATE public.memberships
          SET status = 'active', end_date = (_ms.end_date + _frozen_days)
          WHERE id = _membership_id;
        END IF;
      END IF;

    ELSIF _req.reference_type = 'trainer_change' THEN
      IF (_data->>'memberId') IS NOT NULL AND (_data->>'newTrainerId') IS NOT NULL THEN
        UPDATE public.members SET assigned_trainer_id = (_data->>'newTrainerId')::uuid
        WHERE id = (_data->>'memberId')::uuid;
      END IF;

    ELSIF _req.approval_type = 'membership_transfer' THEN
      IF _to_member_id IS NOT NULL AND _membership_id IS NOT NULL THEN
        UPDATE public.memberships SET member_id = _to_member_id WHERE id = _membership_id;
        INSERT INTO public.member_lifecycle_events(member_id, event_type, reference_id)
        VALUES (_to_member_id, 'membership_transfer', _membership_id);
      END IF;

    ELSIF _req.approval_type = 'branch_transfer' THEN
      DECLARE _mid uuid := COALESCE((_data->>'member_id')::uuid, _req.reference_id);
      BEGIN
        IF _mid IS NOT NULL AND _to_branch_id IS NOT NULL THEN
          UPDATE public.members SET branch_id = _to_branch_id WHERE id = _mid;
          UPDATE public.memberships SET branch_id = _to_branch_id
          WHERE member_id = _mid AND status IN ('active', 'frozen');
        END IF;
      END;

    ELSIF _req.approval_type = 'comp_gift' THEN
      IF _req.reference_type = 'extend_days' AND _membership_id IS NOT NULL
         AND COALESCE((_data->>'days')::int, 0) > 0 THEN
        UPDATE public.memberships
        SET end_date = end_date + (_data->>'days')::int
        WHERE id = _membership_id;
      ELSIF _req.reference_type = 'comp_sessions' THEN
        PERFORM public.grant_member_comp(
          p_member_id           := (_data->>'memberId')::uuid,
          p_benefit_type_id     := (_data->>'benefitTypeId')::uuid,
          p_sessions            := COALESCE((_data->>'sessions')::int, 0),
          p_reason              := COALESCE(_data->>'reason','Approved comp'),
          p_notes               := _data->>'notes',
          p_expires_at          := NULLIF(_data->>'expiresAt','')::timestamptz,
          p_source              := 'approval',
          p_approval_request_id := p_request_id,
          p_membership_id       := NULLIF(_data->>'membershipId','')::uuid,
          p_branch_id           := _req.branch_id,
          p_granted_by          := _req.requested_by
        );
      END IF;
    END IF;

    UPDATE public.approval_requests
    SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_review_notes
    WHERE id = p_request_id;

    INSERT INTO public.approval_audit_log(request_id, action, actor_id, success, payload)
    VALUES (p_request_id, 'approved', auth.uid(), true, _audit_payload);

    RETURN jsonb_build_object('success', true, 'status', 'approved',
                              'new_membership_id', _new_membership_id,
                              'invoice_id', _invoice_id);

  EXCEPTION WHEN OTHERS THEN
    _err := SQLERRM;
    INSERT INTO public.approval_audit_log(request_id, action, actor_id, success, error_message, payload)
    VALUES (p_request_id, 'failed', auth.uid(), false, _err, _audit_payload);
    RAISE EXCEPTION 'Approval execution failed: %', _err;
  END;
END;
$function$;

-- ============================================================
-- 5. Security fixes — branch-scope policies flagged by scanner
-- ============================================================

-- expenses: staff must be limited to their visible branches
DROP POLICY IF EXISTS staff_access_expenses ON public.expenses;
CREATE POLICY expenses_owner_admin_all ON public.expenses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY expenses_branch_staff_all ON public.expenses
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

-- ecommerce_orders: keep member self-view; branch-scope staff access
DROP POLICY IF EXISTS staff_access_orders ON public.ecommerce_orders;
CREATE POLICY ecommerce_orders_member_view ON public.ecommerce_orders
  FOR SELECT TO authenticated
  USING (member_id = get_member_id(auth.uid()));
CREATE POLICY ecommerce_orders_owner_admin_all ON public.ecommerce_orders
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY ecommerce_orders_branch_staff_all ON public.ecommerce_orders
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

-- payment_transactions: branch-scope UPDATE for managers
DROP POLICY IF EXISTS "Staff can update payment transactions" ON public.payment_transactions;
CREATE POLICY payment_transactions_owner_admin_update ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY payment_transactions_branch_manager_update ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(),'manager'::app_role)
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    has_role(auth.uid(),'manager'::app_role)
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );
