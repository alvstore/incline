-- Allow members and trainers to read active branch rows so BranchContext
-- can resolve their assigned branch. Without this, the join in
-- useBranchContext returns null and members see "No Branch Assigned"
-- on their dashboard even when members.branch_id is set.
DROP POLICY IF EXISTS "Members and trainers view active branches" ON public.branches;
CREATE POLICY "Members and trainers view active branches"
  ON public.branches
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND has_any_role(auth.uid(), ARRAY['member'::app_role, 'trainer'::app_role])
  );