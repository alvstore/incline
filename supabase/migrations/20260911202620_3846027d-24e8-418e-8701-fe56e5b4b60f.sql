
-- ── Phase 2: renewal orchestration scaffolding (disabled by default) ─────────

CREATE TABLE public.renewal_engine_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  stage_offsets integer[] NOT NULL DEFAULT ARRAY[-14,-7,-3,0,3,7,14],
  channel text NOT NULL DEFAULT 'whatsapp',
  daily_cap integer NOT NULL DEFAULT 100,
  voice_escalate_after integer NOT NULL DEFAULT 3,
  suppress_legacy_expiry_reminders boolean NOT NULL DEFAULT false,
  quiet_start time NOT NULL DEFAULT '21:00',
  quiet_end time NOT NULL DEFAULT '09:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX renewal_engine_config_global ON public.renewal_engine_config ((branch_id IS NULL)) WHERE branch_id IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.renewal_engine_config TO authenticated;
GRANT ALL ON public.renewal_engine_config TO service_role;
ALTER TABLE public.renewal_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view renewal engine config" ON public.renewal_engine_config
  FOR SELECT TO authenticated USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
  );
CREATE POLICY "Admins manage renewal engine config" ON public.renewal_engine_config
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));

CREATE TRIGGER update_renewal_engine_config_updated_at
  BEFORE UPDATE ON public.renewal_engine_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.renewal_engine_config (branch_id, enabled) VALUES (NULL, false);

CREATE TABLE public.renewal_engine_state (
  id text PRIMARY KEY DEFAULT 'global',
  lease_until timestamptz,
  lease_holder text,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_sent_count integer NOT NULL DEFAULT 0,
  sent_date date,
  sent_today integer NOT NULL DEFAULT 0,
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.renewal_engine_state TO authenticated;
GRANT ALL ON public.renewal_engine_state TO service_role;
ALTER TABLE public.renewal_engine_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Management view renewal engine state" ON public.renewal_engine_state
  FOR SELECT TO authenticated USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
  );
INSERT INTO public.renewal_engine_state (id) VALUES ('global');

-- Stage-level dedupe: one reminder per case per stage, enforced by the database
ALTER TABLE public.renewal_case_events ADD COLUMN IF NOT EXISTS stage_key text;
CREATE UNIQUE INDEX renewal_case_events_stage_once
  ON public.renewal_case_events (case_id, stage_key)
  WHERE event_type = 'reminder_sent' AND stage_key IS NOT NULL;

-- ── Lease handling (single-flight) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.renewal_engine_acquire_lease(_ttl_seconds integer DEFAULT 300, _holder text DEFAULT 'renewal-engine-tick')
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.renewal_engine_state
     SET lease_until = now() + make_interval(secs => _ttl_seconds),
         lease_holder = _holder,
         last_run_at = now(),
         updated_at = now()
   WHERE id = 'global'
     AND paused = false
     AND (lease_until IS NULL OR lease_until < now())
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END; $$;

CREATE OR REPLACE FUNCTION public.renewal_engine_release_lease(
  _status text, _error text DEFAULT NULL, _sent integer DEFAULT 0,
  _pause boolean DEFAULT false, _pause_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  UPDATE public.renewal_engine_state
     SET lease_until = NULL, lease_holder = NULL,
         last_status = _status, last_error = _error,
         last_sent_count = COALESCE(_sent,0),
         sent_today = CASE WHEN sent_date = v_today THEN sent_today + COALESCE(_sent,0) ELSE COALESCE(_sent,0) END,
         sent_date = v_today,
         consecutive_failures = CASE WHEN _status = 'success' THEN 0 ELSE consecutive_failures + 1 END,
         paused = CASE WHEN _pause THEN true ELSE paused END,
         paused_reason = CASE WHEN _pause THEN _pause_reason ELSE paused_reason END,
         updated_at = now()
   WHERE id = 'global';
END; $$;

-- ── Due-case selection ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.renewal_due_cases(_limit integer DEFAULT 50)
RETURNS TABLE (
  case_id uuid, branch_id uuid, member_id uuid, membership_id uuid,
  stage_key text, days_to_expiry integer, expiry_date date,
  member_name text, phone text, email text, plan_name text,
  attempts_count integer, channel text, voice_escalate_after integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  RETURN QUERY
  SELECT rc.id, rc.branch_id, rc.member_id, rc.membership_id,
         CASE WHEN (v_today - rc.expiry_date) <= 0
              THEN 'T-' || abs(v_today - rc.expiry_date)::text
              ELSE 'T+' || (v_today - rc.expiry_date)::text END AS stage_key,
         (rc.expiry_date - v_today)::integer,
         rc.expiry_date,
         COALESCE(p.full_name, 'Member'),
         p.phone, p.email, mp.name,
         rc.attempts_count,
         cfg.channel, cfg.voice_escalate_after
  FROM public.renewal_cases rc
  JOIN public.members mem ON mem.id = rc.member_id
  LEFT JOIN public.profiles p ON p.id = mem.user_id
  LEFT JOIN public.membership_plans mp ON mp.id = rc.plan_id
  JOIN LATERAL (
    SELECT c.* FROM public.renewal_engine_config c
    WHERE c.branch_id = rc.branch_id OR c.branch_id IS NULL
    ORDER BY c.branch_id NULLS LAST LIMIT 1
  ) cfg ON true
  WHERE rc.closed_at IS NULL
    AND cfg.enabled = true
    AND rc.stage IN ('eligible','reminding','lapsed','win_back')
    AND (rc.snoozed_until IS NULL OR rc.snoozed_until < now())
    AND COALESCE(mem.do_not_contact, false) = false
    AND mem.status <> 'blacklisted'
    AND COALESCE(p.phone, p.email) IS NOT NULL
    AND (v_today - rc.expiry_date) = ANY (cfg.stage_offsets)
    AND NOT EXISTS (
      SELECT 1 FROM public.renewal_case_events e
      WHERE e.case_id = rc.id AND e.event_type = 'reminder_sent'
        AND e.stage_key = CASE WHEN (v_today - rc.expiry_date) <= 0
              THEN 'T-' || abs(v_today - rc.expiry_date)::text
              ELSE 'T+' || (v_today - rc.expiry_date)::text END
    )
  ORDER BY rc.expiry_date ASC
  LIMIT GREATEST(_limit, 0);
END; $$;

-- ── Record a contact attempt ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.renewal_mark_contacted(
  _case_id uuid, _stage_key text, _channel text, _status text,
  _detail text DEFAULT NULL, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.renewal_cases%ROWTYPE;
        v_cfg public.renewal_engine_config%ROWTYPE;
        v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_next_stage public.renewal_stage;
BEGIN
  SELECT * INTO v_case FROM public.renewal_cases WHERE id = _case_id AND closed_at IS NULL;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('success', false, 'reason', 'case_closed'); END IF;

  SELECT * INTO v_cfg FROM public.renewal_engine_config
   WHERE branch_id = v_case.branch_id OR branch_id IS NULL
   ORDER BY branch_id NULLS LAST LIMIT 1;

  IF _status IN ('sent','queued') THEN
    INSERT INTO public.renewal_case_events (case_id, branch_id, event_type, stage, channel, detail, stage_key, payload)
    VALUES (_case_id, v_case.branch_id, 'reminder_sent', 'reminding', _channel, _detail, _stage_key, COALESCE(_payload,'{}'::jsonb))
    ON CONFLICT DO NOTHING;

    v_next_stage := CASE
      WHEN v_case.expiry_date < v_today AND (v_case.attempts_count + 1) >= COALESCE(v_cfg.voice_escalate_after, 3)
        THEN 'voice_escalation'::public.renewal_stage
      WHEN v_case.expiry_date < v_today THEN 'lapsed'::public.renewal_stage
      ELSE 'reminding'::public.renewal_stage END;

    UPDATE public.renewal_cases
       SET attempts_count = attempts_count + 1,
           last_stage_key = _stage_key,
           last_contact_at = now(),
           stage = v_next_stage,
           updated_at = now()
     WHERE id = _case_id;
  ELSE
    INSERT INTO public.renewal_case_events (case_id, branch_id, event_type, stage, channel, detail, stage_key, payload)
    VALUES (_case_id, v_case.branch_id, 'reminder_failed', v_case.stage, _channel, _detail, NULL, COALESCE(_payload,'{}'::jsonb));
  END IF;

  RETURN jsonb_build_object('success', true, 'status', _status);
END; $$;

REVOKE EXECUTE ON FUNCTION public.renewal_engine_acquire_lease(integer, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.renewal_engine_release_lease(text, text, integer, boolean, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.renewal_due_cases(integer) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.renewal_mark_contacted(uuid, text, text, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_engine_acquire_lease(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.renewal_engine_release_lease(text, text, integer, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.renewal_due_cases(integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_mark_contacted(uuid, text, text, text, text, jsonb) TO service_role;

-- Register the worker, DISABLED
INSERT INTO public.automation_rules (branch_id, key, name, description, category, worker, cron_expression, is_active, is_system)
VALUES (NULL, 'renewal_engine_tick', 'Renewal Engine',
        'Contacts members due for renewal through the central communication dispatcher. Disabled until Phase 2 is approved for go-live.',
        'retention', 'edge:renewal-engine-tick', '*/30 * * * *', false, true)
ON CONFLICT DO NOTHING;
