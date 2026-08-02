DROP POLICY IF EXISTS "leave_self_rw" ON public.leave_requests;

CREATE POLICY "leave_self_select" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "leave_self_insert" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND COALESCE(status, 'pending') = 'pending');

CREATE POLICY "leave_self_update_pending" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "leave_self_delete_pending" ON public.leave_requests
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending');

-- Belt and braces: even with a permissive policy, a non-approver can never
-- stamp approval fields on their own row.
CREATE OR REPLACE FUNCTION public.tg_leave_block_self_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id = auth.uid()
     AND NOT (
       public.has_role(auth.uid(), 'owner')
       OR public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'manager')
     )
  THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    THEN
      RAISE EXCEPTION 'You cannot approve or reject your own leave request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_block_self_approval ON public.leave_requests;
CREATE TRIGGER trg_leave_block_self_approval
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_leave_block_self_approval();