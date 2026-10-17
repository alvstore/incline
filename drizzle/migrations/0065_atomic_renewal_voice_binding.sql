CREATE OR REPLACE FUNCTION public.tg_voice_bind_renewal_case() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
-- guard-exempt: internal insert trigger only; no direct client execution.
DECLARE v_id uuid; v_case public.renewal_cases%ROWTYPE;
BEGIN
 IF NEW.member_id IS NULL OR NEW.reason<>'member_renewal' THEN RETURN NEW; END IF;
 v_id:=nullif(NEW.eligibility_snapshot->>'renewal_case_id','')::uuid;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.renewal_cases WHERE member_id=NEW.member_id AND branch_id=NEW.branch_id AND closed_at IS NULL ORDER BY expiry_date DESC LIMIT 1; END IF;
 SELECT * INTO v_case FROM public.renewal_cases WHERE id=v_id FOR UPDATE;
 IF NOT FOUND OR v_case.member_id IS DISTINCT FROM NEW.member_id OR v_case.branch_id IS DISTINCT FROM NEW.branch_id OR v_case.closed_at IS NOT NULL OR v_case.claimed_by IS NOT NULL OR v_case.stage NOT IN ('eligible','reminding','lapsed','win_back','voice_escalation') THEN RAISE EXCEPTION 'Renewal case is not eligible for automated calling'; END IF;
 NEW.renewal_case_id:=v_case.id;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.tg_voice_bind_renewal_case() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tg_voice_bind_renewal_case() TO service_role;
CREATE TRIGGER tg_voice_bind_renewal_case BEFORE INSERT ON public.voice_call_attempts FOR EACH ROW EXECUTE FUNCTION public.tg_voice_bind_renewal_case();
DO $patch$ DECLARE v text; BEGIN
v:=pg_get_functiondef('public.tg_voice_sync_renewal_case'::regproc);
v:=replace(v,$a$WHEN NEW.disposition IN('not_interested','wrong_person')$a$,$b$WHEN NEW.disposition IN('renewal_declined','not_interested','wrong_person')$b$);
v:=replace(v,$a$now()+interval '1 day'$a$,$b$now()+interval '7 days'$b$);
EXECUTE v;
END $patch$;