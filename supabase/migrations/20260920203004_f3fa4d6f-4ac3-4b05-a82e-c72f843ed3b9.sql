-- ============================================================
-- Multi-slot recurring class engine — parent (class_types) → rules (class_templates) → sessions (classes)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.class_shift_type AS ENUM ('morning', 'afternoon', 'evening');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- helper: shift bucket for a wall-clock time ----------
CREATE OR REPLACE FUNCTION public.class_shift_for_time(p_time time)
RETURNS public.class_shift_type
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_time < time '12:00' THEN 'morning'::public.class_shift_type
    WHEN p_time < time '16:30' THEN 'afternoon'::public.class_shift_type
    ELSE 'evening'::public.class_shift_type
  END
$$;

-- ---------- 1. class_types (parent) ----------
CREATE TABLE IF NOT EXISTS public.class_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  description text,
  image_url text,
  default_venue text,
  benefit_type_id uuid REFERENCES public.benefit_types(id) ON DELETE SET NULL,
  requires_benefit boolean NOT NULL DEFAULT false,
  is_paid boolean NOT NULL DEFAULT false,
  price numeric NOT NULL DEFAULT 0,
  gst_rate numeric NOT NULL DEFAULT 18,
  is_gst_inclusive boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_types_name_len CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT class_types_price_nonneg CHECK (price >= 0),
  CONSTRAINT class_types_gst_range CHECK (gst_rate >= 0 AND gst_rate <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS class_types_branch_name_key ON public.class_types (branch_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_class_types_branch_active ON public.class_types (branch_id, is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_types TO authenticated;
GRANT ALL ON public.class_types TO service_role;

ALTER TABLE public.class_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View class types" ON public.class_types;
CREATE POLICY "View class types" ON public.class_types
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
    OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    OR branch_id = public.get_user_branch(auth.uid())
    OR branch_id = public.member_branch_id(public.get_member_id(auth.uid()))
  );

DROP POLICY IF EXISTS "Manage class types" ON public.class_types;
CREATE POLICY "Manage class types" ON public.class_types
  FOR ALL TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    AND (
      public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
      OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    AND (
      public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
      OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  );

DROP TRIGGER IF EXISTS update_class_types_updated_at ON public.class_types;
CREATE TRIGGER update_class_types_updated_at BEFORE UPDATE ON public.class_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS audit_class_types_trigger ON public.class_types;
CREATE TRIGGER audit_class_types_trigger AFTER INSERT OR DELETE OR UPDATE ON public.class_types
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger_function();

-- ---------- 2. class_templates (schedule rules) ----------
CREATE TABLE IF NOT EXISTS public.class_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id uuid NOT NULL REFERENCES public.class_types(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  label text,
  shift_type public.class_shift_type NOT NULL DEFAULT 'morning',
  trainer_id uuid REFERENCES public.trainers(id) ON DELETE SET NULL,
  external_trainer_name text,
  start_time time NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  capacity integer NOT NULL DEFAULT 20,
  recurring_days smallint[] NOT NULL,
  venue text,
  valid_from date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  valid_until date,
  generate_days_ahead integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_templates_duration_range CHECK (duration_minutes BETWEEN 10 AND 480),
  CONSTRAINT class_templates_capacity_pos CHECK (capacity > 0),
  CONSTRAINT class_templates_days_nonempty CHECK (cardinality(recurring_days) > 0),
  CONSTRAINT class_templates_days_range CHECK (recurring_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  CONSTRAINT class_templates_horizon_range CHECK (generate_days_ahead BETWEEN 1 AND 90),
  CONSTRAINT class_templates_valid_range CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT class_templates_one_trainer CHECK (NOT (trainer_id IS NOT NULL AND external_trainer_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_class_templates_type ON public.class_templates (class_type_id);
CREATE INDEX IF NOT EXISTS idx_class_templates_branch_active ON public.class_templates (branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_class_templates_trainer ON public.class_templates (trainer_id) WHERE trainer_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_templates TO authenticated;
GRANT ALL ON public.class_templates TO service_role;

ALTER TABLE public.class_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View class templates" ON public.class_templates;
CREATE POLICY "View class templates" ON public.class_templates
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
    OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    OR branch_id = public.get_user_branch(auth.uid())
    OR branch_id = public.member_branch_id(public.get_member_id(auth.uid()))
  );

DROP POLICY IF EXISTS "Manage class templates" ON public.class_templates;
CREATE POLICY "Manage class templates" ON public.class_templates
  FOR ALL TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    AND (
      public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
      OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[])
    AND (
      public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
      OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  );

DROP TRIGGER IF EXISTS update_class_templates_updated_at ON public.class_templates;
CREATE TRIGGER update_class_templates_updated_at BEFORE UPDATE ON public.class_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS audit_class_templates_trigger ON public.class_templates;
CREATE TRIGGER audit_class_templates_trigger AFTER INSERT OR DELETE OR UPDATE ON public.class_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger_function();

-- ---------- 3. classes → sessions ----------
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS class_type_id uuid REFERENCES public.class_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.class_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_date date,
  ADD COLUMN IF NOT EXISTS shift_type public.class_shift_type,
  ADD COLUMN IF NOT EXISTS is_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_notified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS classes_template_session_date_key
  ON public.classes (template_id, session_date) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classes_class_type ON public.classes (class_type_id) WHERE class_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classes_branch_session_date ON public.classes (branch_id, session_date);

-- keep session_date / shift_type derived from scheduled_at (IST wall clock)
CREATE OR REPLACE FUNCTION public.tg_classes_derive_session_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_local timestamp;
BEGIN
  IF NEW.scheduled_at IS NULL THEN RETURN NEW; END IF;
  v_local := NEW.scheduled_at AT TIME ZONE 'Asia/Kolkata';
  IF TG_OP = 'INSERT' OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.session_date IS NULL THEN
    NEW.session_date := v_local::date;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.shift_type IS NULL THEN
    IF NEW.template_id IS NULL OR NEW.shift_type IS NULL THEN
      NEW.shift_type := public.class_shift_for_time(v_local::time);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classes_derive_session_fields ON public.classes;
CREATE TRIGGER classes_derive_session_fields BEFORE INSERT OR UPDATE OF scheduled_at, session_date, shift_type ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.tg_classes_derive_session_fields();

UPDATE public.classes
   SET session_date = (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date,
       shift_type = public.class_shift_for_time((scheduled_at AT TIME ZONE 'Asia/Kolkata')::time)
 WHERE scheduled_at IS NOT NULL AND (session_date IS NULL OR shift_type IS NULL);

-- The audit trigger must not fire for counter maintenance: restrict it to business columns.
DROP TRIGGER IF EXISTS audit_classes_trigger ON public.classes;
CREATE TRIGGER audit_classes_trigger
  AFTER INSERT OR DELETE OR UPDATE OF
    name, description, class_type, capacity, duration_minutes, scheduled_at, trainer_id, external_trainer_name,
    venue, banner_url, is_active, is_paid, price, gst_rate, is_gst_inclusive, benefit_type_id, requires_benefit,
    class_type_id, template_id, is_overridden, cancelled_at, cancellation_reason
  ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger_function();

-- booked_count maintenance
CREATE OR REPLACE FUNCTION public._refresh_class_booked_count(p_class_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.classes c
     SET booked_count = (SELECT count(*) FROM public.class_bookings b WHERE b.class_id = p_class_id AND b.status = 'booked')
   WHERE c.id = p_class_id;
$$;

CREATE OR REPLACE FUNCTION public.tg_sync_class_booked_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public._refresh_class_booked_count(NEW.class_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.class_id IS DISTINCT FROM NEW.class_id) THEN
    PERFORM public._refresh_class_booked_count(OLD.class_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS class_bookings_sync_booked_count ON public.class_bookings;
CREATE TRIGGER class_bookings_sync_booked_count
  AFTER INSERT OR DELETE OR UPDATE OF status, class_id ON public.class_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_class_booked_count();

UPDATE public.classes c
   SET booked_count = COALESCE((SELECT count(*) FROM public.class_bookings b WHERE b.class_id = c.id AND b.status = 'booked'), 0);

-- ---------- 4. generator ----------
CREATE OR REPLACE FUNCTION public.generate_class_sessions(p_template_id uuid DEFAULT NULL, p_days_ahead integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_tpl record;
  v_day date;
  v_horizon date;
  v_start timestamptz;
  v_templates integer := 0;
  v_inserted integer := 0;
  v_rows integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','trainer']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to generate class sessions' USING ERRCODE = '42501';
  END IF;

  FOR v_tpl IN
    SELECT t.*, ct.name AS type_name, ct.description AS type_description, ct.category AS type_category,
           ct.image_url, ct.default_venue, ct.benefit_type_id AS ct_benefit_type_id, ct.requires_benefit AS ct_requires_benefit,
           ct.is_paid AS ct_is_paid, ct.price AS ct_price, ct.gst_rate AS ct_gst_rate, ct.is_gst_inclusive AS ct_is_gst_inclusive
      FROM public.class_templates t
      JOIN public.class_types ct ON ct.id = t.class_type_id
     WHERE t.is_active AND ct.is_active
       AND (p_template_id IS NULL OR t.id = p_template_id)
       AND (
         auth.uid() IS NULL
         OR public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
         OR t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
         OR public.manages_branch(auth.uid(), t.branch_id)
         OR t.branch_id = public.get_user_branch(auth.uid())
       )
  LOOP
    v_templates := v_templates + 1;
    v_horizon := v_today + LEAST(GREATEST(COALESCE(p_days_ahead, v_tpl.generate_days_ahead, 30), 1), 90);
    IF v_tpl.valid_until IS NOT NULL AND v_tpl.valid_until < v_horizon THEN
      v_horizon := v_tpl.valid_until;
    END IF;
    v_day := GREATEST(v_today, v_tpl.valid_from);

    WHILE v_day <= v_horizon LOOP
      IF EXTRACT(DOW FROM v_day)::smallint = ANY (v_tpl.recurring_days) THEN
        v_start := (v_day + v_tpl.start_time) AT TIME ZONE 'Asia/Kolkata';
        IF v_start > now() THEN
          INSERT INTO public.classes (
            branch_id, class_type_id, template_id, session_date, shift_type,
            name, description, class_type, capacity, duration_minutes, scheduled_at,
            trainer_id, external_trainer_name, venue, banner_url,
            benefit_type_id, requires_benefit, is_paid, price, gst_rate, is_gst_inclusive,
            is_recurring, recurrence_rule, is_active
          ) VALUES (
            v_tpl.branch_id, v_tpl.class_type_id, v_tpl.id, v_day, v_tpl.shift_type,
            v_tpl.type_name, v_tpl.type_description, COALESCE(v_tpl.type_category, 'other'), v_tpl.capacity, v_tpl.duration_minutes, v_start,
            v_tpl.trainer_id, v_tpl.external_trainer_name, COALESCE(v_tpl.venue, v_tpl.default_venue), v_tpl.image_url,
            v_tpl.ct_benefit_type_id, v_tpl.ct_requires_benefit, v_tpl.ct_is_paid, v_tpl.ct_price, v_tpl.ct_gst_rate, v_tpl.ct_is_gst_inclusive,
            true, 'template:' || v_tpl.id::text, true
          )
          ON CONFLICT (template_id, session_date) WHERE template_id IS NOT NULL DO NOTHING;
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_inserted := v_inserted + v_rows;
        END IF;
      END IF;
      v_day := v_day + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'templates', v_templates, 'inserted', v_inserted, 'as_of', v_today);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_class_sessions(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_class_sessions(uuid, integer) TO authenticated, service_role;

-- ---------- 5. propagation triggers ----------
CREATE OR REPLACE FUNCTION public.tg_class_templates_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- 5a. push rule changes to future sessions that were not hand-edited
    IF (NEW.start_time, NEW.duration_minutes, NEW.capacity, NEW.trainer_id, NEW.external_trainer_name, NEW.venue, NEW.shift_type)
       IS DISTINCT FROM
       (OLD.start_time, OLD.duration_minutes, OLD.capacity, OLD.trainer_id, OLD.external_trainer_name, OLD.venue, OLD.shift_type) THEN
      UPDATE public.classes c
         SET scheduled_at = (c.session_date + NEW.start_time) AT TIME ZONE 'Asia/Kolkata',
             duration_minutes = NEW.duration_minutes,
             capacity = GREATEST(NEW.capacity, c.booked_count),
             trainer_id = NEW.trainer_id,
             external_trainer_name = NEW.external_trainer_name,
             venue = COALESCE(NEW.venue, ct.default_venue),
             shift_type = NEW.shift_type
        FROM public.class_types ct
       WHERE ct.id = c.class_type_id
         AND c.template_id = NEW.id
         AND c.session_date >= v_today
         AND c.is_overridden = false
         AND c.cancelled_at IS NULL
         AND c.scheduled_at > now();
    END IF;

    -- 5b. prune future sessions that no longer match the rule (only when nobody is booked / waitlisted)
    IF NEW.recurring_days IS DISTINCT FROM OLD.recurring_days
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      DELETE FROM public.classes c
       WHERE c.template_id = NEW.id
         AND c.session_date >= v_today
         AND c.cancelled_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.class_bookings b WHERE b.class_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM public.class_waitlist w WHERE w.class_id = c.id)
         AND (
           NOT NEW.is_active
           OR NOT (EXTRACT(DOW FROM c.session_date)::smallint = ANY (NEW.recurring_days))
           OR c.session_date < NEW.valid_from
           OR (NEW.valid_until IS NOT NULL AND c.session_date > NEW.valid_until)
         );
    END IF;
  END IF;

  IF NEW.is_active THEN
    PERFORM public.generate_class_sessions(NEW.id, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_templates_after_write ON public.class_templates;
CREATE TRIGGER class_templates_after_write AFTER INSERT OR UPDATE ON public.class_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_class_templates_after_write();

CREATE OR REPLACE FUNCTION public.tg_class_types_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF (NEW.name, NEW.description, NEW.category, NEW.image_url, NEW.default_venue,
      NEW.benefit_type_id, NEW.requires_benefit, NEW.is_paid, NEW.price, NEW.gst_rate, NEW.is_gst_inclusive)
     IS DISTINCT FROM
     (OLD.name, OLD.description, OLD.category, OLD.image_url, OLD.default_venue,
      OLD.benefit_type_id, OLD.requires_benefit, OLD.is_paid, OLD.price, OLD.gst_rate, OLD.is_gst_inclusive) THEN
    UPDATE public.classes c
       SET name = NEW.name,
           description = NEW.description,
           class_type = COALESCE(NEW.category, 'other'),
           banner_url = NEW.image_url,
           venue = COALESCE(t.venue, NEW.default_venue),
           benefit_type_id = NEW.benefit_type_id,
           requires_benefit = NEW.requires_benefit,
           is_paid = NEW.is_paid,
           price = NEW.price,
           gst_rate = NEW.gst_rate,
           is_gst_inclusive = NEW.is_gst_inclusive
      FROM public.class_templates t
     WHERE t.id = c.template_id
       AND c.class_type_id = NEW.id
       AND c.session_date >= v_today
       AND c.is_overridden = false
       AND c.cancelled_at IS NULL;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NOT NEW.is_active THEN
      UPDATE public.class_templates SET is_active = false WHERE class_type_id = NEW.id AND is_active;
    ELSE
      PERFORM public.generate_class_sessions(t.id, NULL) FROM public.class_templates t WHERE t.class_type_id = NEW.id AND t.is_active;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_types_after_update ON public.class_types;
CREATE TRIGGER class_types_after_update AFTER UPDATE ON public.class_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_class_types_after_update();

-- ---------- 6. authz helper ----------
CREATE OR REPLACE FUNCTION public.can_manage_class_session(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
     AND (
       public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])
       OR p_branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
       OR public.manages_branch(auth.uid(), p_branch_id)
       OR p_branch_id = public.get_user_branch(auth.uid())
     )
$$;

-- release the class credit consumed by a booking (no-op for free / paid classes)
CREATE OR REPLACE FUNCTION public._release_class_benefit_usage(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_b record;
  v_c record;
  v_id uuid;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_b FROM public.class_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO v_c FROM public.classes WHERE id = v_b.class_id;
  IF NOT FOUND OR v_c.benefit_type_id IS NULL THEN RETURN 0; END IF;

  -- precise match (new bookings tag the usage row)
  DELETE FROM public.benefit_usage bu
   WHERE bu.source_meta ->> 'class_booking_id' = p_booking_id::text;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN v_n; END IF;

  -- legacy fallback: one matching usage row for the same member / class / booking day
  SELECT bu.id INTO v_id
    FROM public.benefit_usage bu
    JOIN public.memberships ms ON ms.id = bu.membership_id
   WHERE ms.member_id = v_b.member_id
     AND bu.benefit_type_id = v_c.benefit_type_id
     AND bu.notes = 'Class: ' || v_c.name
     AND bu.usage_date = (v_b.booked_at AT TIME ZONE 'Asia/Kolkata')::date
   ORDER BY bu.created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    DELETE FROM public.benefit_usage WHERE id = v_id;
    RETURN 1;
  END IF;
  RETURN 0;
END;
$$;

-- ---------- 7. book_class: authz + duplicate-safe + tagged usage ----------
CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _validation jsonb;
  _mode text;
  _membership_id uuid;
  _class RECORD;
  _booking_id uuid;
  _invoice_result jsonb;
  _invoice_id uuid;
  _caller_member uuid;
BEGIN
  SELECT * INTO _class FROM public.classes WHERE id = _class_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Class not found');
  END IF;

  -- Authorisation: members may only book for themselves; staff for anyone in their branches.
  IF auth.uid() IS NOT NULL THEN
    _caller_member := public.get_member_id(auth.uid());
    IF NOT public.can_manage_class_session(_class.branch_id)
       AND (_caller_member IS NULL OR _caller_member <> _member_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only book classes for yourself');
    END IF;
  END IF;

  IF _class.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This class has been cancelled');
  END IF;

  _validation := public.validate_class_booking(_class_id, _member_id);
  IF NOT (_validation->>'valid')::boolean THEN
    RETURN _validation;
  END IF;

  _mode := COALESCE(_validation->>'mode', 'free');
  _membership_id := (_validation->>'membership_id')::uuid;

  -- Paid workshop: create invoice first
  IF _mode = 'paid' AND _class.price > 0 THEN
    _invoice_result := public.create_manual_invoice(
      p_branch_id => _class.branch_id,
      p_member_id => _member_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'description', 'Class: ' || _class.name,
        'quantity', 1,
        'unit_price', _class.price,
        'reference_type', 'class_booking',
        'reference_id', _class_id::text
      )),
      p_due_date => CURRENT_DATE + INTERVAL '7 days',
      p_notes => 'Workshop / paid class booking',
      p_discount_amount => 0,
      p_include_gst => COALESCE(_class.gst_rate, 0) > 0,
      p_gst_rate => COALESCE(_class.gst_rate, 0),
      p_customer_gstin => NULL,
      p_gst_inclusive => COALESCE(_class.is_gst_inclusive, true)
    );
    IF NOT COALESCE((_invoice_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Failed to create invoice for paid class');
    END IF;
    _invoice_id := (_invoice_result->>'invoice_id')::uuid;
  END IF;

  -- Create (or re-activate) the booking — one row per class/member.
  INSERT INTO public.class_bookings (class_id, member_id, status, booked_at, cancelled_at, cancellation_reason, attended_at, no_show_reason)
  VALUES (_class_id, _member_id, 'booked', now(), NULL, NULL, NULL, NULL)
  ON CONFLICT (class_id, member_id) DO UPDATE
     SET status = 'booked', booked_at = now(), cancelled_at = NULL, cancellation_reason = NULL, attended_at = NULL, no_show_reason = NULL
   WHERE public.class_bookings.status IN ('cancelled', 'waitlisted')
  RETURNING id INTO _booking_id;

  IF _booking_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already booked for this class');
  END IF;

  -- Benefit mode: record usage tagged to the booking so cancellation can return it
  IF _mode = 'benefit' AND _class.benefit_type_id IS NOT NULL THEN
    INSERT INTO public.benefit_usage (membership_id, benefit_type, benefit_type_id, usage_date, usage_count, notes, recorded_by, source_meta)
    VALUES (_membership_id, 'group_classes', _class.benefit_type_id, CURRENT_DATE, 1, 'Class: ' || _class.name, auth.uid(),
            jsonb_build_object('kind', 'class_booking', 'class_booking_id', _booking_id, 'class_id', _class_id));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', _booking_id,
    'mode', _mode,
    'invoice_id', _invoice_id
  );
END;
$$;

-- ---------- 8. cancel_class_booking: authz + credit release + duplicate-safe promotion ----------
CREATE OR REPLACE FUNCTION public.cancel_class_booking(_booking_id uuid, _reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _booking RECORD;
  _class RECORD;
  _next_waitlist RECORD;
  _caller_member uuid;
  _promoted boolean := false;
  _released integer := 0;
BEGIN
  SELECT b.*, c.branch_id AS class_branch_id, c.scheduled_at AS class_scheduled_at
    INTO _booking
    FROM public.class_bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.id = _booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found or already cancelled');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    _caller_member := public.get_member_id(auth.uid());
    IF NOT public.can_manage_class_session(_booking.class_branch_id)
       AND (_caller_member IS NULL OR _caller_member <> _booking.member_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only cancel your own bookings');
    END IF;
  END IF;

  UPDATE public.class_bookings
     SET status = 'cancelled', cancelled_at = now(), cancellation_reason = _reason
   WHERE id = _booking_id AND status = 'booked';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found or already cancelled');
  END IF;

  -- Return the class credit when cancelling before the class starts
  IF _booking.class_scheduled_at > now() THEN
    _released := public._release_class_benefit_usage(_booking_id);
  END IF;

  -- Promote from waitlist if exists
  SELECT * INTO _next_waitlist FROM public.class_waitlist
   WHERE class_id = _booking.class_id
   ORDER BY position LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.class_bookings (class_id, member_id, status, booked_at, cancelled_at, cancellation_reason, was_waitlisted)
    VALUES (_booking.class_id, _next_waitlist.member_id, 'booked', now(), NULL, NULL, true)
    ON CONFLICT (class_id, member_id) DO UPDATE
       SET status = 'booked', booked_at = now(), cancelled_at = NULL, cancellation_reason = NULL, was_waitlisted = true
     WHERE public.class_bookings.status <> 'booked';
    _promoted := true;

    UPDATE public.class_waitlist SET notified_at = now() WHERE id = _next_waitlist.id;
    DELETE FROM public.class_waitlist WHERE id = _next_waitlist.id;
    UPDATE public.class_waitlist SET position = position - 1
     WHERE class_id = _booking.class_id AND position > _next_waitlist.position;
  END IF;

  RETURN jsonb_build_object('success', true, 'promoted_from_waitlist', _promoted, 'credit_released', _released > 0);
END;
$$;

-- ---------- 9. session-level staff actions ----------
CREATE OR REPLACE FUNCTION public.cancel_class_session(p_class_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_class record;
  v_b record;
  v_member_ids uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_paid integer := 0;
  v_released integer := 0;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id = p_class_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Class not found');
  END IF;
  IF NOT public.can_manage_class_session(v_class.branch_id) THEN
    RAISE EXCEPTION 'Not authorised to cancel this class' USING ERRCODE = '42501';
  END IF;
  IF v_class.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true, 'cancelled_bookings', 0, 'member_ids', '[]'::jsonb);
  END IF;

  FOR v_b IN SELECT * FROM public.class_bookings WHERE class_id = p_class_id AND status IN ('booked', 'waitlisted') LOOP
    v_released := v_released + public._release_class_benefit_usage(v_b.id);
    UPDATE public.class_bookings
       SET status = 'cancelled', cancelled_at = now(),
           cancellation_reason = 'Class cancelled by the gym' || COALESCE(': ' || NULLIF(btrim(p_reason), ''), '')
     WHERE id = v_b.id;
    v_member_ids := array_append(v_member_ids, v_b.member_id);
    v_count := v_count + 1;
    IF v_class.is_paid THEN v_paid := v_paid + 1; END IF;
  END LOOP;

  DELETE FROM public.class_waitlist WHERE class_id = p_class_id;

  UPDATE public.classes
     SET is_active = false, cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = NULLIF(btrim(p_reason), ''), is_overridden = true
   WHERE id = p_class_id;

  RETURN jsonb_build_object(
    'success', true, 'class_id', p_class_id, 'cancelled_bookings', v_count, 'paid_bookings', v_paid,
    'credits_released', v_released, 'member_ids', to_jsonb(v_member_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reinstate_class_session(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_class record;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id = p_class_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Class not found'); END IF;
  IF NOT public.can_manage_class_session(v_class.branch_id) THEN
    RAISE EXCEPTION 'Not authorised to reinstate this class' USING ERRCODE = '42501';
  END IF;
  IF v_class.cancelled_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'already_active', true);
  END IF;
  IF v_class.scheduled_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reinstate a class that has already started');
  END IF;
  UPDATE public.classes
     SET is_active = true, cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL, cancellation_notified_at = NULL
   WHERE id = p_class_id;
  RETURN jsonb_build_object('success', true, 'class_id', p_class_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.override_class_session(
  p_class_id uuid,
  p_trainer_id uuid DEFAULT NULL,
  p_external_trainer_name text DEFAULT NULL,
  p_capacity integer DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_clear_trainer boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_class record;
  v_new_start timestamptz;
  v_trainer_changed boolean := false;
  v_time_changed boolean := false;
  v_member_ids uuid[];
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id = p_class_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Class not found'); END IF;
  IF NOT public.can_manage_class_session(v_class.branch_id) THEN
    RAISE EXCEPTION 'Not authorised to edit this class' USING ERRCODE = '42501';
  END IF;
  IF v_class.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reinstate the class before editing it');
  END IF;
  IF p_trainer_id IS NOT NULL AND NULLIF(btrim(COALESCE(p_external_trainer_name, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose either a staff trainer or a guest trainer, not both');
  END IF;
  IF p_capacity IS NOT NULL AND p_capacity < v_class.booked_count THEN
    RETURN jsonb_build_object('success', false, 'error', format('Capacity cannot be below the %s members already booked', v_class.booked_count));
  END IF;

  v_new_start := v_class.scheduled_at;
  IF p_start_time IS NOT NULL THEN
    v_new_start := (COALESCE(v_class.session_date, (v_class.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date) + p_start_time) AT TIME ZONE 'Asia/Kolkata';
    IF v_new_start <= now() THEN
      RETURN jsonb_build_object('success', false, 'error', 'The new start time is already in the past');
    END IF;
  END IF;
  v_time_changed := v_new_start IS DISTINCT FROM v_class.scheduled_at
                    OR (p_duration_minutes IS NOT NULL AND p_duration_minutes IS DISTINCT FROM v_class.duration_minutes);

  IF p_clear_trainer OR p_trainer_id IS NOT NULL OR NULLIF(btrim(COALESCE(p_external_trainer_name, '')), '') IS NOT NULL THEN
    v_trainer_changed := (p_trainer_id IS DISTINCT FROM v_class.trainer_id)
                      OR (NULLIF(btrim(COALESCE(p_external_trainer_name, '')), '') IS DISTINCT FROM v_class.external_trainer_name);
  END IF;

  UPDATE public.classes
     SET trainer_id = CASE WHEN p_clear_trainer THEN NULL
                           WHEN p_trainer_id IS NOT NULL THEN p_trainer_id
                           WHEN NULLIF(btrim(COALESCE(p_external_trainer_name, '')), '') IS NOT NULL THEN NULL
                           ELSE trainer_id END,
         external_trainer_name = CASE WHEN p_clear_trainer THEN NULL
                           WHEN NULLIF(btrim(COALESCE(p_external_trainer_name, '')), '') IS NOT NULL THEN btrim(p_external_trainer_name)
                           WHEN p_trainer_id IS NOT NULL THEN NULL
                           ELSE external_trainer_name END,
         capacity = COALESCE(p_capacity, capacity),
         scheduled_at = v_new_start,
         duration_minutes = COALESCE(p_duration_minutes, duration_minutes),
         venue = COALESCE(NULLIF(btrim(COALESCE(p_venue, '')), ''), venue),
         is_overridden = true
   WHERE id = p_class_id;

  SELECT COALESCE(array_agg(member_id), ARRAY[]::uuid[]) INTO v_member_ids
    FROM public.class_bookings WHERE class_id = p_class_id AND status = 'booked';

  RETURN jsonb_build_object(
    'success', true, 'class_id', p_class_id,
    'trainer_changed', v_trainer_changed, 'time_changed', v_time_changed,
    'member_ids', to_jsonb(v_member_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_class_template(p_template_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tpl record;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_c record;
  v_deleted integer := 0;
  v_cancelled integer := 0;
  v_res jsonb;
  v_member_ids jsonb := '[]'::jsonb;
  v_cancelled_ids jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_tpl FROM public.class_templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Schedule rule not found'); END IF;
  IF NOT (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]) AND public.can_manage_class_session(v_tpl.branch_id)) THEN
    RAISE EXCEPTION 'Not authorised to delete this schedule rule' USING ERRCODE = '42501';
  END IF;

  -- future sessions nobody booked → remove; booked ones → cancel (members are notified by the app)
  FOR v_c IN SELECT c.* FROM public.classes c WHERE c.template_id = p_template_id AND c.scheduled_at > now() AND c.cancelled_at IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.class_bookings b WHERE b.class_id = v_c.id)
       AND NOT EXISTS (SELECT 1 FROM public.class_waitlist w WHERE w.class_id = v_c.id) THEN
      DELETE FROM public.classes WHERE id = v_c.id;
      v_deleted := v_deleted + 1;
    ELSE
      v_res := public.cancel_class_session(v_c.id, COALESCE(NULLIF(btrim(p_reason), ''), 'Schedule discontinued'));
      IF COALESCE((v_res->>'success')::boolean, false) THEN
        v_cancelled := v_cancelled + 1;
        v_cancelled_ids := v_cancelled_ids || to_jsonb(v_c.id);
        v_member_ids := v_member_ids || COALESCE(v_res->'member_ids', '[]'::jsonb);
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.class_templates WHERE id = p_template_id;

  RETURN jsonb_build_object('success', true, 'deleted_sessions', v_deleted, 'cancelled_sessions', v_cancelled,
                            'cancelled_class_ids', v_cancelled_ids, 'member_ids', v_member_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_class_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reinstate_class_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.override_class_session(uuid, uuid, text, integer, time, integer, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_class_template(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._release_class_benefit_usage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._refresh_class_booked_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_class_session(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reinstate_class_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.override_class_session(uuid, uuid, text, integer, time, integer, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_class_template(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_class_session(uuid) TO authenticated, service_role;