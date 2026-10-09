DROP POLICY IF EXISTS "Staff manage wallets" ON public.wallets;
DROP POLICY IF EXISTS "Staff manage wallet transactions" ON public.wallet_transactions;

CREATE POLICY "Staff read wallets" ON public.wallets FOR SELECT TO authenticated
USING ((SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role])) OR ((SELECT has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])) AND EXISTS (SELECT 1 FROM members m WHERE m.id = wallets.member_id AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))));

CREATE POLICY "Staff create empty wallets" ON public.wallets FOR INSERT TO authenticated
WITH CHECK (balance = 0 AND total_credited = 0 AND total_debited = 0 AND ((SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role])) OR ((SELECT has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])) AND EXISTS (SELECT 1 FROM members m WHERE m.id = wallets.member_id AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))))));

CREATE POLICY "Staff read wallet transactions" ON public.wallet_transactions FOR SELECT TO authenticated
USING ((SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role])) OR ((SELECT has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])) AND EXISTS (SELECT 1 FROM wallets w JOIN members m ON m.id = w.member_id WHERE w.id = wallet_transactions.wallet_id AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))));

CREATE OR REPLACE FUNCTION public.wallet_adjust(
  p_member_id uuid, p_amount numeric, p_direction text, p_description text,
  p_reference_type text DEFAULT NULL, p_reference_id uuid DEFAULT NULL)
RETURNS public.wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_w public.wallets;
  v_new numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF p_direction NOT IN ('credit','debit') THEN RAISE EXCEPTION 'Invalid direction'; END IF;
  SELECT branch_id INTO v_branch FROM members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  IF p_direction = 'credit' THEN
    -- Adding funds: owners/admins, or a manager of the member's branch.
    IF NOT (has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role])
            OR (has_role(v_uid, 'manager'::app_role) AND v_branch IN (SELECT managed_branch_ids(v_uid)))) THEN
      RAISE EXCEPTION 'Only owners and branch managers can add wallet funds' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT (has_any_role(v_uid, ARRAY['owner'::app_role])
            OR (has_any_role(v_uid, ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role]) AND v_branch IN (SELECT user_visible_branch_ids(v_uid)))) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO wallets (member_id, balance, total_credited, total_debited)
  VALUES (p_member_id, 0, 0, 0) ON CONFLICT (member_id) DO NOTHING;
  SELECT * INTO v_w FROM wallets WHERE member_id = p_member_id FOR UPDATE;

  IF p_direction = 'debit' AND v_w.balance < p_amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  v_new := CASE WHEN p_direction = 'credit' THEN v_w.balance + p_amount ELSE v_w.balance - p_amount END;

  INSERT INTO wallet_transactions (wallet_id, txn_type, amount, balance_after, description, reference_type, reference_id, created_by)
  VALUES (v_w.id, p_direction::wallet_txn_type, p_amount, v_new, left(coalesce(p_description,''), 500), p_reference_type, p_reference_id, v_uid);

  UPDATE wallets SET balance = v_new,
    total_credited = total_credited + CASE WHEN p_direction='credit' THEN p_amount ELSE 0 END,
    total_debited = total_debited + CASE WHEN p_direction='debit' THEN p_amount ELSE 0 END
  WHERE id = v_w.id RETURNING * INTO v_w;
  RETURN v_w;
END $$;

REVOKE ALL ON FUNCTION public.wallet_adjust(uuid, numeric, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_adjust(uuid, numeric, text, text, text, uuid) TO authenticated, service_role;