CREATE TABLE public.app_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  install_id text NOT NULL CHECK (length(install_id) BETWEEN 8 AND 80),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  person_type text NOT NULL DEFAULT 'member' CHECK (person_type IN ('member','trainer','staff','manager','admin')),
  platform text NOT NULL CHECK (platform IN ('ios','android','web_pwa','web_browser')),
  app text NOT NULL DEFAULT 'web' CHECK (app IN ('member_app','team_app','web')),
  app_version text,
  os_version text,
  device_model text,
  push_enabled boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, install_id)
);
CREATE INDEX app_devices_branch_seen_idx ON public.app_devices (branch_id, last_seen_at DESC);
CREATE INDEX app_devices_user_idx ON public.app_devices (user_id);

GRANT SELECT ON public.app_devices TO authenticated;
GRANT ALL ON public.app_devices TO service_role;
ALTER TABLE public.app_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_devices_select_own ON public.app_devices FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY app_devices_select_admin ON public.app_devices FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['owner','admin']::text[])));
CREATE POLICY app_devices_select_manager ON public.app_devices FOR SELECT TO authenticated
  USING (branch_id IN (SELECT public.managed_branch_ids((SELECT auth.uid()))));

ALTER PUBLICATION supabase_realtime ADD TABLE public.app_devices;

CREATE OR REPLACE FUNCTION public.register_app_device(
  p_install_id text, p_platform text, p_app text DEFAULT 'web',
  p_app_version text DEFAULT NULL, p_os_version text DEFAULT NULL,
  p_device_model text DEFAULT NULL, p_push_enabled boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_type text; v_branch uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  IF p_platform NOT IN ('ios','android','web_pwa','web_browser') THEN RAISE EXCEPTION 'bad platform'; END IF;
  IF p_app NOT IN ('member_app','team_app','web') THEN p_app := 'web'; END IF;
  SELECT CASE
    WHEN bool_or(role::text IN ('owner','admin')) THEN 'admin'
    WHEN bool_or(role::text = 'manager') THEN 'manager'
    WHEN bool_or(role::text = 'trainer') THEN 'trainer'
    WHEN bool_or(role::text = 'staff') THEN 'staff'
    ELSE 'member' END
  INTO v_type FROM public.user_roles WHERE user_id = v_uid;
  v_type := coalesce(v_type, 'member');
  SELECT branch_id INTO v_branch FROM public.members WHERE user_id = v_uid ORDER BY created_at DESC LIMIT 1;
  IF v_branch IS NULL THEN v_branch := public.get_user_branch(v_uid); END IF;

  INSERT INTO public.app_devices AS d (user_id, install_id, branch_id, person_type, platform, app, app_version, os_version, device_model, push_enabled)
  VALUES (v_uid, left(p_install_id,80), v_branch, v_type, p_platform, p_app, left(p_app_version,40), left(p_os_version,40), left(p_device_model,60), coalesce(p_push_enabled,false))
  ON CONFLICT (user_id, install_id) DO UPDATE SET
    branch_id = EXCLUDED.branch_id, person_type = EXCLUDED.person_type, platform = EXCLUDED.platform,
    app = EXCLUDED.app, app_version = coalesce(EXCLUDED.app_version, d.app_version),
    os_version = coalesce(EXCLUDED.os_version, d.os_version), device_model = coalesce(EXCLUDED.device_model, d.device_model),
    push_enabled = coalesce(p_push_enabled, d.push_enabled), last_seen_at = now()
  WHERE d.last_seen_at < now() - interval '90 seconds';
END $$;
REVOKE ALL ON FUNCTION public.register_app_device(text,text,text,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_app_device(text,text,text,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.app_usage_summary(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_admin boolean; v_branches uuid[]; v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  v_admin := public.has_any_role(v_uid, ARRAY['owner','admin']::text[]);
  IF v_admin THEN
    v_branches := CASE WHEN p_branch_id IS NULL THEN NULL ELSE ARRAY[p_branch_id] END;
  ELSE
    SELECT array_agg(b) INTO v_branches FROM public.managed_branch_ids(v_uid) b;
    IF v_branches IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
    IF p_branch_id IS NOT NULL THEN
      IF NOT (p_branch_id = ANY(v_branches)) THEN RAISE EXCEPTION 'not allowed'; END IF;
      v_branches := ARRAY[p_branch_id];
    END IF;
  END IF;

  WITH d AS (
    SELECT * FROM public.app_devices WHERE v_branches IS NULL OR branch_id = ANY(v_branches)
  ), u AS (
    SELECT user_id, max(last_seen_at) seen, (array_agg(person_type ORDER BY last_seen_at DESC))[1] person_type,
           (array_agg(platform ORDER BY last_seen_at DESC))[1] platform
    FROM d GROUP BY user_id
  ), cal AS (
    SELECT gs::date AS d_day FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 29, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') gs
  ), mem AS (
    SELECT count(*) n FROM public.members m WHERE m.user_id IS NOT NULL AND m.status = 'active'
      AND (v_branches IS NULL OR m.branch_id = ANY(v_branches))
  ), mem_app AS (
    SELECT count(DISTINCT m.user_id) n FROM public.members m JOIN u ON u.user_id = m.user_id
    WHERE m.status = 'active' AND (v_branches IS NULL OR m.branch_id = ANY(v_branches))
  )
  SELECT jsonb_build_object(
    'online_now', (SELECT count(*) FROM u WHERE seen > now() - interval '5 minutes'),
    'dau', (SELECT count(*) FROM u WHERE seen > now() - interval '1 day'),
    'wau', (SELECT count(*) FROM u WHERE seen > now() - interval '7 days'),
    'mau', (SELECT count(*) FROM u WHERE seen > now() - interval '30 days'),
    'total_users', (SELECT count(*) FROM u),
    'by_platform', (SELECT coalesce(jsonb_object_agg(platform, n), '{}'::jsonb) FROM (SELECT platform, count(*) n FROM u WHERE seen > now() - interval '30 days' GROUP BY 1) x),
    'by_person', (SELECT coalesce(jsonb_object_agg(person_type, n), '{}'::jsonb) FROM (SELECT person_type, count(*) n FROM u WHERE seen > now() - interval '30 days' GROUP BY 1) x),
    'active_members', (SELECT n FROM mem),
    'members_with_app', (SELECT n FROM mem_app),
    'trend', (SELECT jsonb_agg(jsonb_build_object('day', cal.d_day, 'users',
        (SELECT count(DISTINCT d.user_id) FROM d WHERE (d.last_seen_at AT TIME ZONE 'Asia/Kolkata')::date >= cal.d_day
           AND (d.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date <= cal.d_day)) ORDER BY cal.d_day) FROM cal)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.app_usage_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_usage_summary(uuid) TO authenticated;