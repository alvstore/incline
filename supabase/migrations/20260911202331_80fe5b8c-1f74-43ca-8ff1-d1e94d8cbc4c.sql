
-- ── Phase 1 safety corrections: passive, evidence-based renewal detection ────

-- 1. Engine kill-switch, default OFF
INSERT INTO public.settings (branch_id, key, value)
VALUES (NULL, 'renewal_engine_enabled', 'false'::jsonb)
ON CONFLICT DO NOTHING;

-- 2. Track evidence on the case
ALTER TABLE public.renewal_cases
  ADD COLUMN IF NOT EXISTS candidate_membership_id uuid,
  ADD COLUMN IF NOT EXISTS renewal_evidence text,
  ADD COLUMN IF NOT EXISTS paused_reason text;

-- 3. Authoritative evidence check for a successor membership
CREATE OR REPLACE FUNCTION public.renewal_payment_evidence(_membership_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
      WHERE ii.reference_type = 'membership'
        AND ii.reference_id = _membership_id
        AND i.status IN ('paid','partial')
        AND COALESCE(i.amount_paid,0) > 0
        AND COALESCE(i.is_proforma,false) = false
    ) THEN 'invoice_paid'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_items ii
      JOIN public.payments p ON p.invoice_id = ii.invoice_id
      WHERE ii.reference_type = 'membership'
        AND ii.reference_id = _membership_id
        AND p.status = 'completed'
        AND p.voided_at IS NULL
    ) THEN 'payment_settled'
    WHEN EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = _membership_id
        AND m.status IN ('active','frozen')
        AND COALESCE(m.price_paid,0) = 0
    ) THEN 'complimentary'
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.renewal_payment_evidence(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_payment_evidence(uuid) TO authenticated, service_role;

-- 4. Replace the trigger: NEVER assume a new membership is a renewal
CREATE OR REPLACE FUNCTION public.tg_renewal_case_sync()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.renewal_cases%ROWTYPE;
        v_evidence text;
BEGIN
  -- A follow-on membership that extends cover past an open case's expiry.
  IF NEW.status IN ('active','pending','frozen') THEN
    FOR v_case IN
      SELECT rc.* FROM public.renewal_cases rc
      WHERE rc.member_id = NEW.member_id
        AND rc.closed_at IS NULL
        AND rc.membership_id <> NEW.id
        AND NEW.end_date > rc.expiry_date
    LOOP
      v_evidence := public.renewal_payment_evidence(NEW.id);

      IF v_evidence IS NOT NULL AND NEW.status IN ('active','frozen') THEN
        UPDATE public.renewal_cases
           SET stage = 'renewed',
               outcome = CASE WHEN v_evidence = 'complimentary'
                              THEN 'renewed_complimentary' ELSE 'renewed' END,
               renewal_evidence = v_evidence,
               renewed_membership_id = NEW.id,
               candidate_membership_id = NEW.id,
               next_action_at = NULL,
               closed_at = now(),
               updated_at = now()
         WHERE id = v_case.id AND closed_at IS NULL;
        PERFORM public.log_renewal_case_event(v_case.id, 'renewal_confirmed', 'renewed', NULL,
          'Renewal confirmed by ' || v_evidence,
          jsonb_build_object('membership_id', NEW.id, 'evidence', v_evidence));
      ELSE
        -- Only a candidate: no payment evidence yet, case stays open.
        UPDATE public.renewal_cases
           SET candidate_membership_id = NEW.id, updated_at = now()
         WHERE id = v_case.id AND closed_at IS NULL
           AND candidate_membership_id IS DISTINCT FROM NEW.id;
        IF FOUND THEN
          PERFORM public.log_renewal_case_event(v_case.id, 'renewal_candidate', NULL, NULL,
            'Follow-on membership created without payment evidence yet',
            jsonb_build_object('membership_id', NEW.id, 'status', NEW.status));
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Frozen: pause the case, do not close it.
    IF NEW.status = 'frozen' THEN
      UPDATE public.renewal_cases
         SET stage = 'frozen', paused_reason = 'membership_frozen',
             next_action_at = NULL, updated_at = now()
       WHERE membership_id = NEW.id AND closed_at IS NULL;
    -- Unfrozen: resume.
    ELSIF NEW.status = 'active' AND OLD.status = 'frozen' THEN
      UPDATE public.renewal_cases
         SET stage = 'eligible', paused_reason = NULL, updated_at = now()
       WHERE membership_id = NEW.id AND closed_at IS NULL AND stage = 'frozen';
    -- Cancelled / transferred / upgraded: close.
    ELSIF NEW.status IN ('cancelled','transferred','upgraded') THEN
      UPDATE public.renewal_cases
         SET stage = 'cancelled', outcome = NEW.status::text,
             next_action_at = NULL, closed_at = now(), updated_at = now()
       WHERE membership_id = NEW.id AND closed_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END; $$;

-- 5. Detection: idempotent, also resolves evidence for existing open cases
CREATE OR REPLACE FUNCTION public.detect_renewal_cases(_lookahead_days integer DEFAULT 21)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_opened integer := 0;
        v_refreshed integer := 0;
        v_closed integer := 0;
        v_case record;
        v_succ record;
        v_evidence text;
BEGIN
  WITH candidates AS (
    SELECT m.id AS membership_id, m.member_id, m.branch_id, m.plan_id, m.end_date
    FROM public.memberships m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.status IN ('active','expired','frozen')
      AND m.end_date BETWEEN v_today - 30 AND v_today + _lookahead_days
      AND mem.status <> 'blacklisted'
  ), upserted AS (
    INSERT INTO public.renewal_cases (branch_id, member_id, membership_id, plan_id, expiry_date, stage)
    SELECT c.branch_id, c.member_id, c.membership_id, c.plan_id, c.end_date, 'eligible'
    FROM candidates c
    ON CONFLICT (membership_id) DO UPDATE
      SET expiry_date = EXCLUDED.expiry_date,
          plan_id = EXCLUDED.plan_id,
          updated_at = now()
      WHERE public.renewal_cases.closed_at IS NULL
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
  INTO v_opened, v_refreshed FROM upserted;

  -- Resolve open cases where a successor membership now has payment evidence.
  FOR v_case IN
    SELECT * FROM public.renewal_cases WHERE closed_at IS NULL
  LOOP
    SELECT m.* INTO v_succ
    FROM public.memberships m
    WHERE m.member_id = v_case.member_id
      AND m.id <> v_case.membership_id
      AND m.status IN ('active','frozen')
      AND m.end_date > v_case.expiry_date
    ORDER BY m.end_date DESC LIMIT 1;

    IF v_succ.id IS NOT NULL THEN
      v_evidence := public.renewal_payment_evidence(v_succ.id);
      IF v_evidence IS NOT NULL THEN
        UPDATE public.renewal_cases
           SET stage = 'renewed',
               outcome = CASE WHEN v_evidence = 'complimentary'
                              THEN 'renewed_complimentary' ELSE 'renewed' END,
               renewal_evidence = v_evidence,
               renewed_membership_id = v_succ.id,
               candidate_membership_id = v_succ.id,
               next_action_at = NULL, closed_at = now(), updated_at = now()
         WHERE id = v_case.id;
        PERFORM public.log_renewal_case_event(v_case.id, 'renewal_confirmed', 'renewed', NULL,
          'Renewal confirmed by ' || v_evidence,
          jsonb_build_object('membership_id', v_succ.id, 'evidence', v_evidence));
        v_closed := v_closed + 1;
      ELSIF v_case.candidate_membership_id IS DISTINCT FROM v_succ.id THEN
        UPDATE public.renewal_cases
           SET candidate_membership_id = v_succ.id, updated_at = now()
         WHERE id = v_case.id;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'opened', COALESCE(v_opened,0), 'refreshed', COALESCE(v_refreshed,0),
    'closed_renewed', v_closed, 'as_of', v_today,
    'engine_enabled', COALESCE((SELECT value::text = 'true' FROM public.settings
                                WHERE branch_id IS NULL AND key = 'renewal_engine_enabled'), false)
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.detect_renewal_cases(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.detect_renewal_cases(integer) TO service_role;

-- 6. Read-only verification report
CREATE OR REPLACE FUNCTION public.renewal_cases_report()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'engine_enabled', COALESCE((SELECT value::text = 'true' FROM public.settings
                                WHERE branch_id IS NULL AND key = 'renewal_engine_enabled'), false),
    'total_cases', (SELECT count(*) FROM public.renewal_cases),
    'open_cases', (SELECT count(*) FROM public.renewal_cases WHERE closed_at IS NULL),
    'by_stage', (SELECT COALESCE(jsonb_object_agg(stage, c), '{}'::jsonb)
                 FROM (SELECT stage::text AS stage, count(*) c FROM public.renewal_cases GROUP BY 1) s),
    'by_evidence', (SELECT COALESCE(jsonb_object_agg(ev, c), '{}'::jsonb)
                    FROM (SELECT COALESCE(renewal_evidence,'none') ev, count(*) c
                          FROM public.renewal_cases GROUP BY 1) e),
    'events_logged', (SELECT count(*) FROM public.renewal_case_events)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.renewal_cases_report() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_cases_report() TO authenticated, service_role;
