CREATE OR REPLACE FUNCTION public.upgrade_analytics_summary(p_branch_id uuid, p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stats jsonb; v_rows jsonb; v_total bigint; v_financial boolean;
BEGIN
 IF public.rpc_guard_applies('upgrade_analytics_summary') THEN
  PERFORM public.assert_branch_staff(p_branch_id, false, 'view annual upgrade analytics');
  IF NOT public.has_capability(auth.uid(), 'view_financials') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 END IF;
 v_financial := auth.uid() IS NULL OR public.has_capability(auth.uid(), 'view_financials');
 SELECT count(*) INTO v_total FROM public.upgrade_offers o JOIN public.memberships ms ON ms.id=o.membership_id JOIN public.membership_plans mp ON mp.id=ms.plan_id
 WHERE o.branch_id=p_branch_id AND o.status IN ('pending','day7_sent','day12_sent') AND ms.status='active' AND mp.duration_days IN (30,90,180) AND ms.start_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND o.window_ends_at > now();
 SELECT jsonb_build_object('in_window',v_total,'closing_soon',(SELECT count(*) FROM public.upgrade_offers o JOIN public.memberships ms ON ms.id=o.membership_id JOIN public.membership_plans mp ON mp.id=ms.plan_id WHERE o.branch_id=p_branch_id AND o.status IN ('pending','day7_sent','day12_sent') AND ms.status='active' AND mp.duration_days IN (30,90,180) AND ms.start_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND o.window_ends_at>now() AND o.window_ends_at<=now()+interval '3 days'),
 'converted_month',count(*) FILTER(WHERE status='converted' AND converted_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'),
 'conversion_revenue_month',CASE WHEN v_financial THEN coalesce(sum(upgrade_cost) FILTER(WHERE status='converted' AND converted_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'),0) ELSE NULL END) INTO v_stats FROM public.upgrade_offers WHERE branch_id=p_branch_id;
 SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
  SELECT o.id,o.member_id,o.status,o.window_ends_at,ms.start_date,m.joined_at,m.member_code,coalesce(p.full_name,'Member') member_name,mp.name plan_name,
   CASE WHEN v_financial THEN o.upgrade_cost ELSE NULL END upgrade_cost,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('stage',s.stage,'status',coalesce(l.delivery_status::text,'scheduled'),'timestamp',l.created_at,'reason',l.error_message)), '[]'::jsonb) FROM (VALUES ('d7'),('d12')) s(stage) LEFT JOIN LATERAL (SELECT delivery_status,created_at,error_message FROM public.communication_logs WHERE dedupe_key='upgrade:'||o.id::text||':'||s.stage||':wa' ORDER BY created_at DESC LIMIT 1) l ON true) reminders
  FROM public.upgrade_offers o JOIN public.members m ON m.id=o.member_id JOIN public.memberships ms ON ms.id=o.membership_id JOIN public.membership_plans mp ON mp.id=ms.plan_id LEFT JOIN public.profiles p ON p.id=m.user_id
  WHERE o.branch_id=p_branch_id AND o.status IN ('pending','day7_sent','day12_sent') AND ms.status='active' AND mp.duration_days IN (30,90,180) AND ms.start_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND o.window_ends_at>now()
  ORDER BY o.window_ends_at,o.id LIMIT 10 OFFSET greatest(coalesce(p_page,0),0)*10
 ) t;
 RETURN jsonb_build_object('stats',v_stats,'offers',v_rows,'total',v_total,'server_now',now());
END; $$;
REVOKE ALL ON FUNCTION public.upgrade_analytics_summary(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.upgrade_analytics_summary(uuid,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.upgrade_analytics_summary(uuid,integer) IS 'Financial-capability and branch-guarded active upgrade timelines; outcomes come from dispatcher logs, not backfilled offer stages.';