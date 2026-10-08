
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS login_disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS login_disabled_reason text,
  ADD COLUMN IF NOT EXISTS login_disabled_by uuid,
  ADD COLUMN IF NOT EXISTS login_disabled_source text CHECK (login_disabled_source IN ('manual','auto'));

CREATE INDEX IF NOT EXISTS members_login_disabled_idx ON public.members (login_disabled_source) WHERE login_disabled_at IS NOT NULL;

-- Service-role helper: who should be auto-revoked / auto-restored
CREATE OR REPLACE FUNCTION public.member_login_access_candidates()
RETURNS TABLE(member_id uuid, user_id uuid, action text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.user_id, 'revoke'::text
  FROM public.members m
  WHERE m.user_id IS NOT NULL AND m.login_disabled_at IS NULL
    AND (
      m.status IN ('inactive','suspended','blacklisted')
      OR (
        EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id = m.id AND (ms.status IN ('active','frozen') OR (ms.status = 'pending' AND ms.end_date >= current_date)))
        AND (SELECT max(ms.end_date) FROM public.memberships ms WHERE ms.member_id = m.id) < current_date - 7
      )
    )
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.user_id AND r.role <> 'member')
  UNION ALL
  SELECT m.id, m.user_id, 'restore'::text
  FROM public.members m
  WHERE m.user_id IS NOT NULL AND m.login_disabled_source = 'auto'
    AND m.status = 'active'
    AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id = m.id AND ms.status IN ('active','frozen'));
$$;
REVOKE EXECUTE ON FUNCTION public.member_login_access_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_login_access_candidates() TO service_role;

INSERT INTO public.settings (branch_id, key, value, description)
SELECT NULL, 'member_login_autorevoke', '{"enabled": true}'::jsonb, 'Auto-revoke member app login 7 days after membership expiry or when inactive'
WHERE NOT EXISTS (SELECT 1 FROM public.settings WHERE branch_id IS NULL AND key = 'member_login_autorevoke');

-- PT trainer transfers
CREATE TABLE public.pt_trainer_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_pt_package_id uuid NOT NULL REFERENCES public.member_pt_packages(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  from_trainer_id uuid NOT NULL REFERENCES public.trainers(id),
  to_trainer_id uuid NOT NULL REFERENCES public.trainers(id),
  effective_date date NOT NULL,
  moved_installment_ids uuid[] NOT NULL DEFAULT '{}',
  moved_session_ids uuid[] NOT NULL DEFAULT '{}',
  moved_amount numeric NOT NULL DEFAULT 0,
  previous_assigned_trainer_id uuid,
  reassigned_general_trainer boolean NOT NULL DEFAULT false,
  reason text,
  performed_by uuid,
  undone_at timestamptz,
  undone_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pt_trainer_transfers TO authenticated;
GRANT ALL ON public.pt_trainer_transfers TO service_role;
ALTER TABLE public.pt_trainer_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read branch PT transfers" ON public.pt_trainer_transfers FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[])) OR branch_id IN (SELECT public.managed_branch_ids(auth.uid())));
CREATE INDEX pt_trainer_transfers_pkg_idx ON public.pt_trainer_transfers (member_pt_package_id, created_at DESC);
CREATE INDEX pt_trainer_transfers_from_idx ON public.pt_trainer_transfers (from_trainer_id);

CREATE OR REPLACE FUNCTION public.transfer_pt_package_trainer(
  _package_ids uuid[], _to_trainer uuid, _effective_date date, _keep_general boolean DEFAULT false, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pkg record; v_to record; v_inst uuid[]; v_sess uuid[]; v_amt numeric; v_prev uuid; v_last date; v_count int := 0; v_total numeric := 0;
BEGIN
  IF rpc_guard_applies('transfer_pt_package_trainer') AND NOT has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden: only owner, admin or manager can transfer PT clients' USING ERRCODE = '42501';
  END IF;
  IF _effective_date IS NULL OR _to_trainer IS NULL OR coalesce(array_length(_package_ids,1),0) = 0 THEN
    RAISE EXCEPTION 'Missing trainer, packages or effective date';
  END IF;
  SELECT id, branch_id, is_active INTO v_to FROM trainers WHERE id = _to_trainer;
  IF v_to.id IS NULL OR NOT v_to.is_active THEN RAISE EXCEPTION 'New trainer is not active'; END IF;

  FOR pkg IN SELECT * FROM member_pt_packages WHERE id = ANY(_package_ids) FOR UPDATE LOOP
    IF rpc_guard_applies('transfer_pt_package_trainer') THEN
      PERFORM assert_branch_staff(pkg.branch_id, false, 'transfer_pt_package_trainer');
    END IF;
    IF pkg.trainer_id = _to_trainer THEN CONTINUE; END IF;
    IF pkg.status NOT IN ('active','pending_payment') THEN RAISE EXCEPTION 'Package % is not active', pkg.id; END IF;

    SELECT max(scheduled_at)::date INTO v_last FROM pt_sessions
      WHERE member_pt_package_id = pkg.id AND status IN ('completed','late','absent','no_show');
    IF v_last IS NOT NULL AND _effective_date < v_last THEN
      RAISE EXCEPTION 'Effective date cannot be before the last completed session (%)', v_last;
    END IF;

    SELECT coalesce(array_agg(i.id),'{}'), coalesce(sum(i.installment_amount),0) INTO v_inst, v_amt
    FROM pt_commission_installments i JOIN trainer_commissions tc ON tc.id = i.commission_id
    WHERE tc.pt_package_id = pkg.id AND i.trainer_id = pkg.trainer_id
      AND i.status = 'pending' AND i.payroll_item_id IS NULL
      AND i.payout_month >= date_trunc('month', _effective_date)::date;
    UPDATE pt_commission_installments SET trainer_id = _to_trainer, updated_at = now() WHERE id = ANY(v_inst);

    SELECT coalesce(array_agg(id),'{}') INTO v_sess FROM pt_sessions
      WHERE member_pt_package_id = pkg.id AND trainer_id = pkg.trainer_id
        AND status IN ('scheduled','rescheduled') AND scheduled_at >= _effective_date::timestamptz;
    UPDATE pt_sessions SET trainer_id = _to_trainer, updated_at = now() WHERE id = ANY(v_sess);

    SELECT assigned_trainer_id INTO v_prev FROM members WHERE id = pkg.member_id;
    UPDATE member_pt_packages SET trainer_id = _to_trainer, updated_at = now() WHERE id = pkg.id;
    IF NOT coalesce(_keep_general,false) THEN
      UPDATE members SET assigned_trainer_id = _to_trainer WHERE id = pkg.member_id;
    END IF;

    INSERT INTO pt_trainer_transfers(member_pt_package_id, member_id, branch_id, from_trainer_id, to_trainer_id, effective_date,
      moved_installment_ids, moved_session_ids, moved_amount, previous_assigned_trainer_id, reassigned_general_trainer, reason, performed_by)
    VALUES (pkg.id, pkg.member_id, pkg.branch_id, pkg.trainer_id, _to_trainer, _effective_date,
      v_inst, v_sess, v_amt, v_prev, NOT coalesce(_keep_general,false), _reason, auth.uid());
    v_count := v_count + 1; v_total := v_total + v_amt;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'transferred', v_count, 'moved_amount', v_total);
END $$;
REVOKE EXECUTE ON FUNCTION public.transfer_pt_package_trainer(uuid[], uuid, date, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_pt_package_trainer(uuid[], uuid, date, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.undo_pt_trainer_transfer(_transfer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record;
BEGIN
  IF rpc_guard_applies('undo_pt_trainer_transfer') AND NOT has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM pt_trainer_transfers WHERE id = _transfer_id FOR UPDATE;
  IF t.id IS NULL OR t.undone_at IS NOT NULL THEN RAISE EXCEPTION 'Transfer not found or already undone'; END IF;
  IF rpc_guard_applies('undo_pt_trainer_transfer') THEN
    PERFORM assert_branch_staff(t.branch_id, false, 'undo_pt_trainer_transfer');
  END IF;
  IF date_trunc('month', t.created_at) <> date_trunc('month', now()) THEN RAISE EXCEPTION 'Transfers can only be undone in the same month'; END IF;
  IF EXISTS (SELECT 1 FROM pt_commission_installments WHERE id = ANY(t.moved_installment_ids) AND (payroll_item_id IS NOT NULL OR status <> 'pending')) THEN
    RAISE EXCEPTION 'A moved commission part has already been settled — cannot undo';
  END IF;
  IF EXISTS (SELECT 1 FROM pt_trainer_transfers WHERE member_pt_package_id = t.member_pt_package_id AND created_at > t.created_at AND undone_at IS NULL) THEN
    RAISE EXCEPTION 'A later transfer exists for this package — undo that first';
  END IF;
  UPDATE pt_commission_installments SET trainer_id = t.from_trainer_id, updated_at = now() WHERE id = ANY(t.moved_installment_ids);
  UPDATE pt_sessions SET trainer_id = t.from_trainer_id, updated_at = now() WHERE id = ANY(t.moved_session_ids) AND status IN ('scheduled','rescheduled');
  UPDATE member_pt_packages SET trainer_id = t.from_trainer_id, updated_at = now() WHERE id = t.member_pt_package_id;
  IF t.reassigned_general_trainer THEN
    UPDATE members SET assigned_trainer_id = t.previous_assigned_trainer_id WHERE id = t.member_id AND assigned_trainer_id = t.to_trainer_id;
  END IF;
  UPDATE pt_trainer_transfers SET undone_at = now(), undone_by = auth.uid() WHERE id = t.id;
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.undo_pt_trainer_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_pt_trainer_transfer(uuid) TO authenticated, service_role;
