DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.howbody_scan_quota(uuid,text)'::regprocedure);
  d := replace(d, $a$  SELECT COALESCE(SUM(mbc.credits_remaining), 0) INTO v_addon_remaining$a$,
$a$  -- Manually recorded plan usage (Record Usage) has no HOWBODY data_key; count it too.
  IF v_benefit_type_id IS NOT NULL THEN
    v_used_this_period := v_used_this_period + COALESCE((
      SELECT SUM(bu.usage_count) FROM public.benefit_usage bu
      JOIN public.memberships mb ON mb.id = bu.membership_id
      WHERE mb.member_id = _member_id AND bu.benefit_type_id = v_benefit_type_id
        AND (bu.source_meta IS NULL OR NOT (bu.source_meta ? 'data_key'))
        AND (v_period_start IS NULL OR bu.usage_date >= (v_period_start AT TIME ZONE 'Asia/Kolkata')::date)), 0);
    v_used_this_month := v_used_this_month + COALESCE((
      SELECT SUM(bu.usage_count) FROM public.benefit_usage bu
      JOIN public.memberships mb ON mb.id = bu.membership_id
      WHERE mb.member_id = _member_id AND bu.benefit_type_id = v_benefit_type_id
        AND (bu.source_meta IS NULL OR NOT (bu.source_meta ? 'data_key'))
        AND bu.usage_date >= (v_month_start AT TIME ZONE 'Asia/Kolkata')::date), 0);
  END IF;

  SELECT COALESCE(SUM(mbc.credits_remaining), 0) INTO v_addon_remaining$a$);
  EXECUTE d;
END $$;