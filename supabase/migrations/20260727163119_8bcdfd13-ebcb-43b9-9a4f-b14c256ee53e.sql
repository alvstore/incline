
-- ============================================================
-- C3 + Locker item label: fix assign_locker_with_billing overloads
-- ============================================================

CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(
  p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date,
  p_fee_amount numeric, p_billing_months integer DEFAULT 1,
  p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric,
  p_received_by uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_locker record; v_assignment_id uuid; v_invoice_id uuid := NULL;
  v_invoice_item_id uuid; v_branch_id uuid; v_total numeric;
  v_gst_rate numeric; v_gst record; v_item_label text;
BEGIN
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOCKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_locker.status <> 'available' THEN
    RAISE EXCEPTION 'LOCKER_TAKEN: locker % is %', v_locker.locker_number, v_locker.status USING ERRCODE = 'P0001';
  END IF;
  v_branch_id := v_locker.branch_id;

  INSERT INTO public.locker_assignments (locker_id, member_id, start_date, end_date, fee_amount, is_active)
  VALUES (p_locker_id, p_member_id, p_start_date, p_end_date, p_fee_amount, true)
  RETURNING id INTO v_assignment_id;

  UPDATE public.lockers SET status = 'assigned', updated_at = now() WHERE id = p_locker_id;

  IF p_chargeable AND COALESCE(p_fee_amount,0) > 0 THEN
    v_total := round(p_fee_amount * COALESCE(p_billing_months,1), 2);
    v_gst_rate := COALESCE(p_gst_rate, public.resolve_gst_rate('locker', p_locker_id, v_branch_id));
    SELECT * INTO v_gst FROM public.calc_gst(v_total, v_gst_rate, false, true);
    INSERT INTO public.invoices (member_id, branch_id, total_amount, amount_paid, status, due_date, created_by)
    VALUES (p_member_id, v_branch_id, v_gst.total, 0, 'pending', p_end_date, p_received_by)
    RETURNING id INTO v_invoice_id;

    v_item_label := 'Locker ' || v_locker.locker_number
      || ' (' || to_char(p_start_date, 'DD Mon YYYY') || ' – ' || to_char(p_end_date, 'DD Mon YYYY') || ')';

    INSERT INTO public.invoice_items (invoice_id, item_type, item_name, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_invoice_id, 'locker', v_item_label, 1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id, 'branch_id', v_branch_id);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id',p_locker_id,'member_id',p_member_id));
  RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(
  p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date,
  p_fee_amount numeric, p_billing_months integer DEFAULT 1,
  p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric,
  p_received_by uuid DEFAULT NULL::uuid, p_assign_source text DEFAULT 'addon'::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_locker record; v_assignment_id uuid; v_invoice_id uuid := NULL;
  v_invoice_item_id uuid; v_branch_id uuid; v_total numeric;
  v_gst_rate numeric; v_gst record;
  v_effective_end_date date; v_membership_end date; v_chargeable boolean;
  v_item_label text;
BEGIN
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOCKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_locker.status <> 'available' THEN
    RAISE EXCEPTION 'LOCKER_TAKEN: locker % is %', v_locker.locker_number, v_locker.status USING ERRCODE = 'P0001';
  END IF;
  v_branch_id := v_locker.branch_id;
  v_effective_end_date := p_end_date;
  v_chargeable := p_chargeable;

  IF p_assign_source = 'plan' THEN
    SELECT m.end_date INTO v_membership_end
    FROM public.memberships m
    WHERE m.member_id = p_member_id AND m.status = 'active' AND m.end_date >= p_start_date
    ORDER BY m.end_date DESC LIMIT 1;
    IF v_membership_end IS NOT NULL THEN v_effective_end_date := v_membership_end; END IF;
    v_chargeable := false;
  END IF;

  INSERT INTO public.locker_assignments (locker_id, member_id, start_date, end_date, fee_amount, is_active)
  VALUES (p_locker_id, p_member_id, p_start_date, v_effective_end_date,
          CASE WHEN v_chargeable THEN p_fee_amount ELSE 0 END, true)
  RETURNING id INTO v_assignment_id;

  UPDATE public.lockers SET status = 'assigned', updated_at = now() WHERE id = p_locker_id;

  IF v_chargeable AND COALESCE(p_fee_amount,0) > 0 THEN
    v_total := round(p_fee_amount * COALESCE(p_billing_months,1), 2);
    v_gst_rate := COALESCE(p_gst_rate, public.resolve_gst_rate('locker', p_locker_id, v_branch_id));
    SELECT * INTO v_gst FROM public.calc_gst(v_total, v_gst_rate, false, true);
    INSERT INTO public.invoices (member_id, branch_id, total_amount, amount_paid, status, due_date, created_by)
    VALUES (p_member_id, v_branch_id, v_gst.total, 0, 'pending', v_effective_end_date, p_received_by)
    RETURNING id INTO v_invoice_id;

    v_item_label := 'Locker ' || v_locker.locker_number
      || ' (' || to_char(p_start_date, 'DD Mon YYYY') || ' – ' || to_char(v_effective_end_date, 'DD Mon YYYY') || ')';

    INSERT INTO public.invoice_items (invoice_id, item_type, item_name, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_invoice_id, 'locker', v_item_label, 1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id, 'branch_id', v_branch_id, 'source', p_assign_source, 'end_date', v_effective_end_date);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id', p_locker_id, 'member_id', p_member_id, 'source', p_assign_source));
  RAISE;
END; $function$;

-- ============================================================
-- C5: break members SELECT policy recursion
-- Replace trainer_can_view_member() call with an inline expression
-- that touches only trainers + member_pt_packages (no members).
-- ============================================================

DROP POLICY IF EXISTS "View members policy" ON public.members;

CREATE POLICY "View members policy" ON public.members
FOR SELECT
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (branch_id = get_user_branch(auth.uid()) OR manages_branch(auth.uid(), branch_id))
  )
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND (
      assigned_trainer_id IN (SELECT id FROM public.trainers WHERE user_id = auth.uid())
      OR id IN (
        SELECT mpp.member_id
        FROM public.member_pt_packages mpp
        JOIN public.trainers t ON t.id = mpp.trainer_id
        WHERE t.user_id = auth.uid() AND mpp.status = 'active'::pt_package_status
      )
    )
  )
);

-- ============================================================
-- C1 + C2: staff/admin can write member avatars in `avatars` bucket
-- ============================================================

CREATE OR REPLACE FUNCTION public.staff_can_write_avatar(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_folder text;
  v_owner_uuid uuid;
  v_member_branch uuid;
BEGIN
  IF _user_id IS NULL OR _path IS NULL THEN RETURN false; END IF;

  v_folder := split_part(_path, '/', 1);
  IF v_folder = '' THEN RETURN false; END IF;

  -- Own folder — always allowed (matches existing owner-only policy).
  IF v_folder = _user_id::text THEN RETURN true; END IF;

  -- Admin / Owner: unconditional.
  IF public.has_any_role(_user_id, ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN true;
  END IF;

  BEGIN
    v_owner_uuid := v_folder::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Find the target member's branch (folder = member's user_id).
  SELECT branch_id INTO v_member_branch
  FROM public.members
  WHERE user_id = v_owner_uuid
  LIMIT 1;

  IF v_member_branch IS NULL THEN RETURN false; END IF;

  -- Manager / staff of that branch.
  IF public.has_any_role(_user_id, ARRAY['manager','staff']::public.app_role[])
     AND (v_member_branch = public.get_user_branch(_user_id) OR public.manages_branch(_user_id, v_member_branch))
  THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

DROP POLICY IF EXISTS "Staff upload member avatar" ON storage.objects;
DROP POLICY IF EXISTS "Staff update member avatar" ON storage.objects;
DROP POLICY IF EXISTS "Staff delete member avatar" ON storage.objects;

CREATE POLICY "Staff upload member avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND public.staff_can_write_avatar(auth.uid(), name));

CREATE POLICY "Staff update member avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND public.staff_can_write_avatar(auth.uid(), name))
WITH CHECK (bucket_id = 'avatars' AND public.staff_can_write_avatar(auth.uid(), name));

CREATE POLICY "Staff delete member avatar"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND public.staff_can_write_avatar(auth.uid(), name));
