DO $patch$ DECLARE v text; BEGIN
 v:=pg_get_functiondef('public.tg_voice_outreach_outcome'::regproc);
 v:=replace(v,' IF NEW.member_id IS NOT NULL',E' IF TG_OP=''UPDATE'' AND OLD.outreach_stop_reason IS NOT NULL THEN\n   IF NEW.outreach_stop_reason IS NULL OR OLD.outreach_stop_reason IN (''relocated'',''do_not_contact'') THEN NEW.outreach_stop_reason:=OLD.outreach_stop_reason; END IF;\n END IF;\n IF NEW.member_id IS NOT NULL');
 EXECUTE v;
END $patch$;
COMMENT ON COLUMN public.voice_call_attempts.outreach_stop_reason IS 'Persisted outcome suppression. Duplicate/late callbacks cannot clear a recorded decline or relocation; transactional channel preferences remain unchanged.';