UPDATE public.campaigns
SET status = 'draft',
    last_run_error = 'stuck_sending_reset_by_migration'
WHERE status = 'sending'
  AND coalesce(recipients_count, 0) = 0
  AND created_at < now() - interval '15 minutes';

CREATE OR REPLACE FUNCTION public.reap_stuck_sending_campaigns(p_max_age_min integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.campaigns
  SET status = 'draft',
      last_run_error = coalesce(last_run_error || ' | ', '') || 'auto_reset:stuck_sending_no_recipients'
  WHERE status = 'sending'
    AND coalesce(recipients_count, 0) = 0
    AND created_at < now() - make_interval(mins => p_max_age_min);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_sending_campaigns(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stuck_sending_campaigns(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reset_campaign_to_draft(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
    AND role::text IN ('owner','admin','manager','staff')
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  UPDATE public.campaigns
  SET status = 'draft',
      last_run_error = 'manual_reset_by_operator'
  WHERE id = p_campaign_id
    AND status IN ('sending','failed');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_campaign_to_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_campaign_to_draft(uuid) TO authenticated, service_role;