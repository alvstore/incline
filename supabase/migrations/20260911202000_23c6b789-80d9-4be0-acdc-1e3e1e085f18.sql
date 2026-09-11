
-- ── Renewal & Retention engine — Phase 1 foundation ──────────────────────────
CREATE TYPE public.renewal_stage AS ENUM (
  'eligible','reminding','voice_escalation','staff_followup','callback',
  'lapsed','win_back','renewed','not_interested','frozen','cancelled',
  'churned','suppressed'
);

CREATE TABLE public.renewal_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  plan_id uuid,
  expiry_date date NOT NULL,
  stage public.renewal_stage NOT NULL DEFAULT 'eligible',
  last_stage_key text,
  next_action_at timestamptz,
  attempts_count integer NOT NULL DEFAULT 0,
  voice_attempts_count integer NOT NULL DEFAULT 0,
  last_contact_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  snoozed_until timestamptz,
  outcome text,
  churn_reason text,
  renewed_membership_id uuid,
  closed_at timestamptz,
  value_score numeric NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renewal_cases_membership_unique UNIQUE (membership_id)
);

CREATE INDEX idx_renewal_cases_branch_stage ON public.renewal_cases (branch_id, stage);
CREATE INDEX idx_renewal_cases_due ON public.renewal_cases (next_action_at) WHERE closed_at IS NULL;
CREATE INDEX idx_renewal_cases_member ON public.renewal_cases (member_id);

CREATE TABLE public.renewal_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.renewal_cases(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  event_type text NOT NULL,
  stage public.renewal_stage,
  channel text,
  detail text,
  actor_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_renewal_case_events_case ON public.renewal_case_events (case_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.renewal_cases TO authenticated;
GRANT ALL ON public.renewal_cases TO service_role;
GRANT SELECT, INSERT ON public.renewal_case_events TO authenticated;
GRANT ALL ON public.renewal_case_events TO service_role;

ALTER TABLE public.renewal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewal_case_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view branch renewal cases" ON public.renewal_cases
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR branch_id = get_user_branch(auth.uid())
    OR manages_branch(auth.uid(), branch_id)
  );

CREATE POLICY "Staff update branch renewal cases" ON public.renewal_cases
  FOR UPDATE TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR branch_id = get_user_branch(auth.uid())
    OR manages_branch(auth.uid(), branch_id)
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR branch_id = get_user_branch(auth.uid())
    OR manages_branch(auth.uid(), branch_id)
  );

CREATE POLICY "Management insert renewal cases" ON public.renewal_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
    AND (branch_id = get_user_branch(auth.uid()) OR manages_branch(auth.uid(), branch_id))
  );

CREATE POLICY "Staff view branch renewal events" ON public.renewal_case_events
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR branch_id = get_user_branch(auth.uid())
    OR manages_branch(auth.uid(), branch_id)
  );

CREATE POLICY "Staff insert branch renewal events" ON public.renewal_case_events
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR branch_id = get_user_branch(auth.uid())
    OR manages_branch(auth.uid(), branch_id)
  );

CREATE TRIGGER update_renewal_cases_updated_at
  BEFORE UPDATE ON public.renewal_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Event logger ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_renewal_case_event(
  _case_id uuid,
  _event_type text,
  _stage public.renewal_stage DEFAULT NULL,
  _channel text DEFAULT NULL,
  _detail text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid; v_id uuid;
BEGIN
  SELECT branch_id INTO v_branch FROM public.renewal_cases WHERE id = _case_id;
  IF v_branch IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.renewal_case_events (case_id, branch_id, event_type, stage, channel, detail, actor_id, payload)
  VALUES (_case_id, v_branch, _event_type, _stage, _channel, _detail, auth.uid(), COALESCE(_payload,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.log_renewal_case_event(uuid, text, public.renewal_stage, text, text, jsonb) TO authenticated, service_role;

-- ── Detection: open / refresh cases for memberships approaching expiry ──────
CREATE OR REPLACE FUNCTION public.detect_renewal_cases(_lookahead_days integer DEFAULT 21)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_opened integer := 0;
        v_refreshed integer := 0;
BEGIN
  WITH candidates AS (
    SELECT m.id AS membership_id, m.member_id, m.branch_id, m.plan_id, m.end_date
    FROM public.memberships m
    JOIN public.members mem ON mem.id = m.member_id
    WHERE m.status IN ('active','expired')
      AND m.end_date BETWEEN v_today - 14 AND v_today + _lookahead_days
      AND mem.status <> 'blacklisted'
      -- no later membership already covering this member
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships m2
        WHERE m2.member_id = m.member_id
          AND m2.id <> m.id
          AND m2.status IN ('active','pending','frozen')
          AND m2.end_date > m.end_date
      )
  ), upserted AS (
    INSERT INTO public.renewal_cases (branch_id, member_id, membership_id, plan_id, expiry_date, stage, next_action_at)
    SELECT c.branch_id, c.member_id, c.membership_id, c.plan_id, c.end_date, 'eligible', now()
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

  RETURN jsonb_build_object('success', true, 'opened', COALESCE(v_opened,0), 'refreshed', COALESCE(v_refreshed,0), 'as_of', v_today);
END; $$;

GRANT EXECUTE ON FUNCTION public.detect_renewal_cases(integer) TO service_role;

-- ── Auto-close on renewal / freeze / cancel ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_renewal_case_sync()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.renewal_cases%ROWTYPE;
BEGIN
  -- A new/updated membership that extends cover closes any open earlier case.
  IF NEW.status IN ('active','pending','frozen') THEN
    FOR v_case IN
      SELECT rc.* FROM public.renewal_cases rc
      JOIN public.memberships om ON om.id = rc.membership_id
      WHERE rc.member_id = NEW.member_id
        AND rc.closed_at IS NULL
        AND rc.membership_id <> NEW.id
        AND NEW.end_date > om.end_date
    LOOP
      UPDATE public.renewal_cases
         SET stage = 'renewed', outcome = 'renewed', renewed_membership_id = NEW.id,
             next_action_at = NULL, closed_at = now(), updated_at = now()
       WHERE id = v_case.id;
      PERFORM public.log_renewal_case_event(v_case.id, 'auto_closed', 'renewed', NULL,
        'Member renewed — reminders stopped', jsonb_build_object('membership_id', NEW.id));
    END LOOP;
  END IF;

  -- Freeze / cancel closes this membership's own case.
  IF TG_OP = 'UPDATE' AND NEW.status IN ('frozen','cancelled','transferred','upgraded')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.renewal_cases
       SET stage = CASE WHEN NEW.status = 'frozen' THEN 'frozen'::public.renewal_stage
                        ELSE 'cancelled'::public.renewal_stage END,
           outcome = NEW.status::text,
           next_action_at = NULL, closed_at = now(), updated_at = now()
     WHERE membership_id = NEW.id AND closed_at IS NULL;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER tg_memberships_renewal_case_sync
  AFTER INSERT OR UPDATE OF status, end_date ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_renewal_case_sync();
