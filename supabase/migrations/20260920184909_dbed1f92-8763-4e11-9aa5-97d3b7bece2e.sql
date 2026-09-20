CREATE OR REPLACE FUNCTION public.renewal_queue_counts(_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability(auth.uid(), 'manage_renewals') THEN
    RAISE EXCEPTION 'Not authorized to manage renewals';
  END IF;

  SELECT jsonb_build_object(
    'all',      count(*),
    'due_soon', count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.expiry_date > v_today),
    'today',    count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.expiry_date = v_today),
    'lapsed',   count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.expiry_date < v_today
                                   AND rc.stage IN ('eligible','reminding','lapsed','staff_followup')),
    'voice',    count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.stage = 'voice_escalation'),
    'callback', count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.stage = 'callback'),
    'won',      count(*) FILTER (WHERE rc.stage IN ('renewed','win_back')),
    'lost',     count(*) FILTER (WHERE rc.stage IN ('not_interested','cancelled','churned'))
  )
  INTO v_result
  FROM public.renewal_cases rc
  WHERE (_branch_id IS NULL OR rc.branch_id = _branch_id)
    AND (auth.uid() IS NULL
         OR public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role,'admin'::public.app_role])
         OR rc.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())));

  RETURN COALESCE(v_result, '{}'::jsonb);
END; $$;

REVOKE EXECUTE ON FUNCTION public.renewal_queue_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_queue_counts(uuid) TO authenticated, service_role;