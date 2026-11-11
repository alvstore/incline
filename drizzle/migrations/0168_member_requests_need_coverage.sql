
CREATE OR REPLACE FUNCTION public.tg_member_request_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_member uuid; v_end date; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF TG_TABLE_NAME = 'approval_requests' THEN
    v_uid := NEW.requested_by;
    IF NEW.reference_type IN ('renewal','membership_renewal','payment') THEN RETURN NEW; END IF;
  ELSE
    IF NOT COALESCE(NEW.member_created, false) THEN RETURN NEW; END IF;
    v_uid := NEW.assigned_by;
  END IF;
  IF v_uid IS NULL OR auth.uid() IS NULL OR v_uid <> auth.uid() THEN RETURN NEW; END IF;
  IF public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff','trainer']::public.app_role[]) THEN RETURN NEW; END IF;
  v_member := public.get_member_id(v_uid);
  IF v_member IS NULL OR NOT public.booking_coverage_enforced(NEW.branch_id) THEN RETURN NEW; END IF;
  IF NOT public.member_has_active_coverage(v_member, v_today) THEN
    SELECT max(end_date) INTO v_end FROM memberships WHERE member_id = v_member;
    RAISE EXCEPTION 'membership_not_covering_date: %',
      CASE WHEN v_end IS NOT NULL THEN 'Your membership ended on ' || to_char(v_end, 'DD Mon') || '. Renew to continue.'
           ELSE 'You need an active membership to send requests.' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_member_request_coverage() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_member_request_coverage ON public.approval_requests;
CREATE TRIGGER trg_member_request_coverage BEFORE INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_request_coverage();
DROP TRIGGER IF EXISTS trg_member_task_coverage ON public.tasks;
CREATE TRIGGER trg_member_task_coverage BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_request_coverage();
