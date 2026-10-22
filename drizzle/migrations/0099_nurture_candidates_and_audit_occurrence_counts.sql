CREATE OR REPLACE FUNCTION public.lead_nurture_candidates(p_delay_hours numeric, p_cooldown_hours numeric, p_max_retries integer)
RETURNS SETOF public.whatsapp_chat_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.* FROM public.whatsapp_chat_settings c
 JOIN LATERAL (SELECT m.direction,m.created_at FROM public.whatsapp_messages m WHERE m.phone_number=c.phone_number AND m.branch_id=c.branch_id ORDER BY m.created_at DESC LIMIT 1) last_msg ON true
 WHERE c.bot_active=true AND c.do_not_contact=false AND c.handoff_reason IS NULL
 AND (c.do_not_contact_until IS NULL OR c.do_not_contact_until<=now())
 AND ((last_msg.direction='inbound' AND COALESCE(c.nurture_retry_count,0)>0)
 OR (last_msg.direction='outbound' AND COALESCE(c.nurture_retry_count,0)<p_max_retries
 AND last_msg.created_at + make_interval(secs => (CASE WHEN COALESCE(c.nurture_retry_count,0)=0 THEN p_delay_hours ELSE p_cooldown_hours END * 3600)::double precision)<=now()
 AND (c.last_nurture_at IS NULL OR c.last_nurture_at <= now()-interval '30 minutes')));
$$;
REVOKE ALL ON FUNCTION public.lead_nurture_candidates(numeric,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lead_nurture_candidates(numeric,numeric,integer) TO service_role;
CREATE INDEX IF NOT EXISTS idx_nurture_latest_message ON public.whatsapp_messages(phone_number,branch_id,created_at DESC) INCLUDE(direction);
CREATE OR REPLACE FUNCTION public.get_error_audit_breakdown(_days integer DEFAULT 7)
RETURNS TABLE(source text,severity text,total bigint,open_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.rpc_guard_applies('get_error_audit_breakdown') AND NOT public.has_any_role(auth.uid(),ARRAY['owner','admin']::public.app_role[]) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(e.source,'frontend'),COALESCE(e.severity,'error'),sum(COALESCE(e.occurrence_count,1))::bigint,sum(CASE WHEN e.status='open' THEN COALESCE(e.occurrence_count,1) ELSE 0 END)::bigint FROM public.error_logs e WHERE COALESCE(e.last_seen,e.created_at)>=now()-make_interval(days=>_days) GROUP BY COALESCE(e.source,'frontend'),COALESCE(e.severity,'error') ORDER BY 3 DESC;
END; $$;
CREATE OR REPLACE FUNCTION public.get_error_audit_daily_trend(_days integer DEFAULT 14)
RETURNS TABLE(day date,total bigint,critical_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.rpc_guard_applies('get_error_audit_daily_trend') AND NOT public.has_any_role(auth.uid(),ARRAY['owner','admin']::public.app_role[]) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT (COALESCE(e.last_seen,e.created_at) AT TIME ZONE 'Asia/Kolkata')::date,sum(COALESCE(e.occurrence_count,1))::bigint,sum(CASE WHEN e.severity='critical' THEN COALESCE(e.occurrence_count,1) ELSE 0 END)::bigint FROM public.error_logs e WHERE COALESCE(e.last_seen,e.created_at)>=now()-make_interval(days=>_days) GROUP BY 1 ORDER BY 1;
END; $$;
CREATE OR REPLACE FUNCTION public.get_error_audit_top_routes(_days integer DEFAULT 7,_limit integer DEFAULT 10)
RETURNS TABLE(route text,total bigint,open_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.rpc_guard_applies('get_error_audit_top_routes') AND NOT public.has_any_role(auth.uid(),ARRAY['owner','admin']::public.app_role[]) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(NULLIF(e.route,''),'—'),sum(COALESCE(e.occurrence_count,1))::bigint,sum(CASE WHEN e.status='open' THEN COALESCE(e.occurrence_count,1) ELSE 0 END)::bigint FROM public.error_logs e WHERE COALESCE(e.last_seen,e.created_at)>=now()-make_interval(days=>_days) AND COALESCE(e.source,'frontend')='frontend' GROUP BY 1 ORDER BY 2 DESC LIMIT _limit;
END; $$;
REVOKE ALL ON FUNCTION public.get_error_audit_breakdown(integer),public.get_error_audit_daily_trend(integer),public.get_error_audit_top_routes(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_error_audit_breakdown(integer),public.get_error_audit_daily_trend(integer),public.get_error_audit_top_routes(integer,integer) TO authenticated,service_role;