DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['analytics_revenue_by_plan','analytics_revenue_series'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
     WHERE p.proname = f AND p.pronamespace = 'public'::regnamespace;
    d := replace(d, 'AND (p_branch IS NULL OR p.branch_id = p_branch)',
      'AND (p_branch IS NULL OR p.branch_id = p_branch)
      AND (public.has_any_role(auth.uid(), ARRAY[''owner'',''admin'']::public.app_role[])
           OR p.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))');
    EXECUTE d;
  END LOOP;
END $$;