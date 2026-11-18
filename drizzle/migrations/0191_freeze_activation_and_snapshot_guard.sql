DO $migration$ DECLARE f text; old_block text; BEGIN
 SELECT pg_get_functiondef('public._apply_membership_freeze(uuid)'::regprocedure) INTO f;
 old_block:=' IF h.start_date>today THEN RETURN; END IF;';
 IF strpos(f,old_block)=0 THEN RAISE EXCEPTION 'Freeze activation changed; review required'; END IF;
 f:=replace(f,old_block,$new$ IF h.mode NOT IN ('plan','paid','override') THEN RAISE EXCEPTION 'Invalid freeze type'; END IF;
 IF h.mode<>'plan' AND NOT COALESCE(s.freeze_exceptions_enabled,false) THEN RAISE EXCEPTION 'Freeze exceptions are currently disabled'; END IF;
 IF h.mode='paid' AND (COALESCE(s.freeze_fee,0)<=0 OR h.fee_charged IS DISTINCT FROM s.freeze_fee) THEN RAISE EXCEPTION 'Paid fee policy changed; resubmit for approval'; END IF;
 IF h.start_date>today THEN RETURN; END IF;$new$);
 EXECUTE f;
END $migration$;
CREATE OR REPLACE FUNCTION public.tg_guard_frozen_membership_expiry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status='frozen' AND NEW.status='frozen' AND NEW.end_date IS DISTINCT FROM OLD.end_date THEN RAISE EXCEPTION 'Resume membership before changing its expiry; frozen expiry is preserved for accurate day credit'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_guard_frozen_membership_expiry() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_frozen_membership_expiry() TO service_role;
CREATE TRIGGER guard_frozen_membership_expiry BEFORE UPDATE OF end_date ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.tg_guard_frozen_membership_expiry();