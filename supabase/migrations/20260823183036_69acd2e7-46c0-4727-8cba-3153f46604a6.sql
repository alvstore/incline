CREATE OR REPLACE FUNCTION public.resolve_campaign_audience_v2(
  p_branch_id uuid,
  p_filter jsonb,
  p_window_hours integer DEFAULT 24
)
RETURNS TABLE(
  source_type text,
  source_ref_id uuid,
  full_name text,
  phone text,
  email text,
  contact_id uuid,
  in_window boolean,
  source_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := COALESCE(p_filter->>'audience_kind', 'members');
  v_status text := COALESCE(p_filter->>'member_status', 'all');
  v_lead_status text[];
  v_staff_roles text[];
  v_today date := CURRENT_DATE;
  v_window_start timestamptz := now() - make_interval(hours => p_window_hours);
BEGIN
  v_lead_status := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'lead_status')), '{}');
  v_staff_roles := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'staff_roles')), '{}');

  IF v_kind = 'segment' AND (p_filter->>'segment_id') IS NOT NULL THEN
    RETURN QUERY
      SELECT * FROM public.resolve_campaign_audience_v2(
        p_branch_id,
        (SELECT filter FROM public.contact_segments WHERE id = (p_filter->>'segment_id')::uuid),
        p_window_hours
      );
    RETURN;
  END IF;

  IF v_kind = 'members_and_staff' THEN
    RETURN QUERY
    WITH candidates AS (
      SELECT 1 AS priority, 'member'::text AS source_type, m.id AS source_ref_id,
             p.full_name, p.phone, p.email, c.id AS contact_id, 'Member'::text AS source_label
      FROM public.members m
      JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.contacts c ON c.source_type = 'member' AND c.source_id = m.id
      WHERE m.branch_id = p_branch_id
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (v_status = 'all'
          OR (v_status = 'active' AND EXISTS (
            SELECT 1 FROM public.memberships ms
            WHERE ms.member_id = m.id AND ms.status = 'active' AND ms.end_date >= v_today
          ))
          OR (v_status = 'expired' AND EXISTS (
            SELECT 1 FROM public.memberships ms
            WHERE ms.member_id = m.id AND ms.end_date < v_today
          )))
      UNION ALL
      SELECT 2, 'staff', p.id, p.full_name, p.phone, p.email, NULL::uuid,
             initcap(ur.role::text)
      FROM public.employees e
      JOIN public.profiles p ON p.id = e.user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE e.branch_id = p_branch_id AND e.is_active = true
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (cardinality(v_staff_roles) = 0 OR ur.role::text = ANY(v_staff_roles))
      UNION ALL
      SELECT 3, 'staff', p.id, p.full_name, p.phone, p.email, NULL::uuid, 'Trainer'
      FROM public.trainers t
      JOIN public.profiles p ON p.id = t.user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE t.branch_id = p_branch_id AND t.is_active = true
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (cardinality(v_staff_roles) = 0 OR ur.role::text = ANY(v_staff_roles))
      UNION ALL
      SELECT 4, 'staff', p.id, p.full_name, p.phone, p.email, NULL::uuid,
             initcap(ur.role::text)
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role::text IN ('owner', 'admin')
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (cardinality(v_staff_roles) = 0 OR ur.role::text = ANY(v_staff_roles))
    ), deduped AS (
      SELECT DISTINCT ON (regexp_replace(phone, '\D', '', 'g'))
        candidates.*
      FROM candidates
      ORDER BY regexp_replace(phone, '\D', '', 'g'), priority
    )
    SELECT d.source_type, d.source_ref_id, d.full_name, d.phone, d.email, d.contact_id,
      EXISTS (
        SELECT 1 FROM public.whatsapp_messages w
        WHERE regexp_replace(COALESCE(w.phone_number, ''), '\D', '', 'g') = regexp_replace(d.phone, '\D', '', 'g')
          AND w.direction = 'inbound' AND w.created_at >= v_window_start
      ), d.source_label
    FROM deduped d;
    RETURN;
  END IF;

  IF v_kind = 'staff' THEN
    RETURN QUERY
    WITH candidates AS (
      SELECT 1 AS priority, 'staff'::text AS source_type, p.id AS source_ref_id,
             p.full_name, p.phone, p.email, NULL::uuid AS contact_id, initcap(ur.role::text) AS source_label
      FROM public.employees e
      JOIN public.profiles p ON p.id = e.user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE e.branch_id = p_branch_id AND e.is_active = true
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (cardinality(v_staff_roles) = 0 OR ur.role::text = ANY(v_staff_roles))
      UNION ALL
      SELECT 2, 'staff', p.id, p.full_name, p.phone, p.email, NULL::uuid, 'Trainer'
      FROM public.trainers t
      JOIN public.profiles p ON p.id = t.user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE t.branch_id = p_branch_id AND t.is_active = true
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (cardinality(v_staff_roles) = 0 OR ur.role::text = ANY(v_staff_roles))
      UNION ALL
      SELECT 3, 'staff', p.id, p.full_name, p.phone, p.email, NULL::uuid, initcap(ur.role::text)
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role::text IN ('owner', 'admin')
        AND NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '') IS NOT NULL
        AND (cardinality(v_staff_roles) = 0 OR ur.role::text = ANY(v_staff_roles))
    ), deduped AS (
      SELECT DISTINCT ON (regexp_replace(phone, '\D', '', 'g')) candidates.*
      FROM candidates ORDER BY regexp_replace(phone, '\D', '', 'g'), priority
    )
    SELECT d.source_type, d.source_ref_id, d.full_name, d.phone, d.email, d.contact_id,
      EXISTS (
        SELECT 1 FROM public.whatsapp_messages w
        WHERE regexp_replace(COALESCE(w.phone_number, ''), '\D', '', 'g') = regexp_replace(d.phone, '\D', '', 'g')
          AND w.direction = 'inbound' AND w.created_at >= v_window_start
      ), d.source_label
    FROM deduped d;
    RETURN;
  END IF;

  IF v_kind IN ('members','mixed') THEN
    RETURN QUERY
      SELECT 'member'::text, m.id, p.full_name, p.phone, p.email, c.id,
        EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.phone_number = p.phone AND w.direction = 'inbound' AND w.created_at >= v_window_start),
        'Member'::text
      FROM public.members m
      JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.contacts c ON c.source_type='member' AND c.source_id=m.id
      WHERE m.branch_id = p_branch_id AND p.phone IS NOT NULL
        AND (v_status='all'
          OR (v_status='active' AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id=m.id AND ms.status='active' AND ms.end_date >= v_today))
          OR (v_status='expired' AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id=m.id AND ms.end_date < v_today)));
  END IF;

  IF v_kind IN ('leads','mixed') THEN
    RETURN QUERY
      SELECT 'lead'::text, l.id, l.full_name, l.phone, l.email, c.id,
        EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.phone_number = l.phone AND w.direction='inbound' AND w.created_at >= v_window_start),
        'Lead'::text
      FROM public.leads l
      LEFT JOIN public.contacts c ON c.source_type='lead' AND c.source_id=l.id
      WHERE l.branch_id=p_branch_id AND l.phone IS NOT NULL
        AND COALESCE(l.status::text,'new') <> 'lost'
        AND (cardinality(v_lead_status)=0 OR l.status::text = ANY(v_lead_status));
  END IF;

  IF v_kind IN ('lost_leads','mixed') THEN
    RETURN QUERY
      SELECT 'lost_lead'::text, l.id, l.full_name, l.phone, l.email, c.id,
        EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.phone_number=l.phone AND w.direction='inbound' AND w.created_at >= v_window_start),
        'Lost lead'::text
      FROM public.leads l
      LEFT JOIN public.contacts c ON c.source_type='lead' AND c.source_id=l.id
      WHERE l.branch_id=p_branch_id AND l.phone IS NOT NULL
        AND (l.status::text='lost' OR (l.last_contacted_at IS NOT NULL AND l.last_contacted_at < now()-interval '60 days'));
  END IF;

  IF v_kind IN ('contacts','mixed') THEN
    RETURN QUERY
      SELECT 'contact'::text, c.id, c.full_name, c.phone, c.email, c.id,
        EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.phone_number=c.phone AND w.direction='inbound' AND w.created_at >= v_window_start),
        'Contact'::text
      FROM public.contacts c
      WHERE c.branch_id=p_branch_id AND c.phone IS NOT NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_audience_v2(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience_v2(uuid, jsonb, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_enqueue_failed_communication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF NEW.status NOT IN ('failed') THEN RETURN NEW; END IF;
  IF NEW.recipient IS NULL OR NEW.content IS NULL OR NEW.type IS NULL THEN RETURN NEW; END IF;

  -- Meta 131049 is a recipient/template pacing decision. Retrying the same
  -- payload worsens ecosystem engagement and cannot make this attempt succeed.
  IF COALESCE(NEW.error_message, '') ~* '(^|\D)131049(\D|$)|healthy ecosystem engagement' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing
  FROM public.communication_retry_queue
  WHERE original_log_id = NEW.id AND status IN ('pending','processing')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.communication_retry_queue (
    original_log_id, branch_id, type, recipient, subject, content,
    template_id, member_id, retry_count, max_retries, next_retry_at,
    last_error, status, metadata
  ) VALUES (
    NEW.id, NEW.branch_id, NEW.type, NEW.recipient, NEW.subject, NEW.content,
    NEW.template_id, NEW.member_id, 0, 3, now() + interval '5 minutes',
    NEW.error_message, 'pending',
    COALESCE(jsonb_build_object('category', NEW.category) || COALESCE(NEW.delivery_metadata, '{}'::jsonb), '{}'::jsonb)
  );
  RETURN NEW;
END;
$$;

UPDATE public.communication_retry_queue
SET status = 'exhausted',
    last_error = COALESCE(last_error, '') || ' [terminal Meta pacing: automated retry disabled]',
    updated_at = now()
WHERE status IN ('pending','processing')
  AND COALESCE(last_error, '') ~* '(^|\D)131049(\D|$)|healthy ecosystem engagement';