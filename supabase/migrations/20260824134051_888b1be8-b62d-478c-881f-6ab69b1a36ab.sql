DROP POLICY IF EXISTS "Staff can select all report tokens" ON public.howbody_public_report_tokens;
DROP POLICY IF EXISTS "Staff manage report tokens" ON public.howbody_public_report_tokens;

CREATE OR REPLACE FUNCTION public.howbody_token_in_visible_branch(_data_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.howbody_body_reports r
    JOIN public.members m ON m.id = r.member_id
    WHERE r.data_key = _data_key
      AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  ) OR EXISTS (
    SELECT 1 FROM public.howbody_posture_reports p
    JOIN public.members m2 ON m2.id = p.member_id
    WHERE p.data_key = _data_key
      AND m2.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );
$$;

CREATE POLICY "Owners and admins manage report tokens"
ON public.howbody_public_report_tokens
FOR ALL
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Branch staff manage report tokens for their members"
ON public.howbody_public_report_tokens
FOR ALL
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
  AND public.howbody_token_in_visible_branch(data_key)
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
  AND public.howbody_token_in_visible_branch(data_key)
);