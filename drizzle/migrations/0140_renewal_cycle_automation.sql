CREATE OR REPLACE FUNCTION public.detect_renewal_cases(_lookahead_days integer DEFAULT 21)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_opened integer := 0; v_refreshed integer := 0; v_closed integer := 0; v_corrected integer := 0;
        v_case record; v_succ record; v_evidence text;
BEGIN
  WITH candidates AS (
    SELECT m.id AS membership_id, m.member_id, m.branch_id, m.plan_id, m.end_date
    FROM public.memberships m JOIN public.members mem ON mem.id = m.member_id
    WHERE m.status IN ('active','expired','frozen')
      AND m.end_date BETWEEN v_today - 30 AND v_today + _lookahead_days
      AND mem.status <> 'blacklisted'
      -- skip if member already holds a later paid/active cover
      AND NOT EXISTS (SELECT 1 FROM public.memberships s WHERE s.member_id = m.member_id
                      AND s.id <> m.id AND s.status IN ('active','frozen') AND s.end_date > m.end_date + _lookahead_days)
  ), upserted AS (
    INSERT INTO public.renewal_cases (branch_id, member_id, membership_id, plan_id, expiry_date, stage)
    SELECT c.branch_id, c.member_id, c.membership_id, c.plan_id, c.end_date, 'eligible' FROM candidates c
    ON CONFLICT (membership_id) DO UPDATE
      SET expiry_date = EXCLUDED.expiry_date, plan_id = EXCLUDED.plan_id, updated_at = now()
      WHERE public.renewal_cases.closed_at IS NULL
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_opened, v_refreshed FROM upserted;

  -- Open cases, plus recently closed "lost" cases, are resolved when a paid successor exists.
  FOR v_case IN
    SELECT * FROM public.renewal_cases
    WHERE closed_at IS NULL
       OR (stage IN ('churned','win_back','not_interested','lapsed') AND closed_at > now() - interval '120 days')
  LOOP
    v_succ := NULL;
    SELECT m.* INTO v_succ FROM public.memberships m
    WHERE m.member_id = v_case.member_id AND m.id <> v_case.membership_id
      AND m.status IN ('active','frozen','expired') AND m.end_date > v_case.expiry_date
      AND (v_case.closed_at IS NULL OR m.status <> 'expired' OR true)
    ORDER BY m.end_date DESC LIMIT 1;
    IF v_succ.id IS NULL THEN CONTINUE; END IF;
    IF v_case.closed_at IS NULL AND v_succ.status = 'expired' THEN CONTINUE; END IF;
    v_evidence := public.renewal_payment_evidence(v_succ.id);
    IF v_evidence IS NOT NULL THEN
      UPDATE public.renewal_cases
         SET stage = 'renewed',
             outcome = CASE WHEN v_evidence = 'complimentary' THEN 'renewed_complimentary' ELSE 'renewed' END,
             renewal_evidence = v_evidence, renewed_membership_id = v_succ.id, candidate_membership_id = v_succ.id,
             next_action_at = NULL, closed_at = COALESCE(closed_at, now()), updated_at = now()
       WHERE id = v_case.id;
      IF v_case.closed_at IS NULL THEN
        PERFORM public.log_renewal_case_event(v_case.id, 'renewal_confirmed', 'renewed', NULL,
          'Renewal confirmed by ' || v_evidence, jsonb_build_object('membership_id', v_succ.id, 'evidence', v_evidence));
        v_closed := v_closed + 1;
      ELSE
        PERFORM public.log_renewal_case_event(v_case.id, 'stage_corrected', 'renewed', NULL,
          'Corrected by audit: paid follow-on membership found (was ' || v_case.stage || ')',
          jsonb_build_object('membership_id', v_succ.id, 'evidence', v_evidence, 'previous_stage', v_case.stage));
        v_corrected := v_corrected + 1;
      END IF;
    ELSIF v_case.closed_at IS NULL AND v_case.candidate_membership_id IS DISTINCT FROM v_succ.id THEN
      UPDATE public.renewal_cases SET candidate_membership_id = v_succ.id, updated_at = now() WHERE id = v_case.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'opened', COALESCE(v_opened,0), 'refreshed', COALESCE(v_refreshed,0),
    'closed_renewed', v_closed, 'corrected', v_corrected, 'as_of', v_today,
    'engine_enabled', COALESCE((SELECT value::text = 'true' FROM public.settings WHERE branch_id IS NULL AND key = 'renewal_engine_enabled'), false));
END; $function$;
REVOKE EXECUTE ON FUNCTION public.detect_renewal_cases(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_renewal_cases(integer) TO service_role;

-- Open the next cycle's case as soon as a membership enters the 21-day window.
CREATE OR REPLACE FUNCTION public.tg_renewal_case_open_cycle()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NEW.status IN ('active','expired','frozen')
     AND NEW.end_date BETWEEN v_today - 30 AND v_today + 21
     AND NOT EXISTS (SELECT 1 FROM public.members mem WHERE mem.id = NEW.member_id AND mem.status = 'blacklisted')
     AND NOT EXISTS (SELECT 1 FROM public.memberships s WHERE s.member_id = NEW.member_id
                     AND s.id <> NEW.id AND s.status IN ('active','frozen') AND s.end_date > NEW.end_date + 21) THEN
    INSERT INTO public.renewal_cases (branch_id, member_id, membership_id, plan_id, expiry_date, stage)
    VALUES (NEW.branch_id, NEW.member_id, NEW.id, NEW.plan_id, NEW.end_date, 'eligible')
    ON CONFLICT (membership_id) DO UPDATE SET expiry_date = EXCLUDED.expiry_date, updated_at = now()
      WHERE public.renewal_cases.closed_at IS NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- never block membership writes
END; $function$;
REVOKE EXECUTE ON FUNCTION public.tg_renewal_case_open_cycle() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tg_memberships_renewal_case_open_cycle ON public.memberships;
CREATE TRIGGER tg_memberships_renewal_case_open_cycle AFTER INSERT OR UPDATE OF status, end_date ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.tg_renewal_case_open_cycle();