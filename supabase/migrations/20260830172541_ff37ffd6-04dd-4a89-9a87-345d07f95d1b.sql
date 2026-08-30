-- 1) feedback_google_link_clicks: remove open public INSERT (service role edge fn records clicks)
DROP POLICY IF EXISTS "Public can insert click records" ON public.feedback_google_link_clicks;
REVOKE INSERT ON public.feedback_google_link_clicks FROM anon;
GRANT ALL ON public.feedback_google_link_clicks TO service_role;

-- 2) google_reviews: branch-scope the manager UPDATE policy
DROP POLICY IF EXISTS "Managers can update google reviews" ON public.google_reviews;
CREATE POLICY "Managers can update google reviews"
ON public.google_reviews
FOR UPDATE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- 3) product_batches: branch-scope the SELECT policy for manager/staff
DROP POLICY IF EXISTS "view_product_batches" ON public.product_batches;
CREATE POLICY "view_product_batches"
ON public.product_batches
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);