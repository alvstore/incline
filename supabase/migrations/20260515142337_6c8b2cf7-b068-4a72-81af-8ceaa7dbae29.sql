CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_branch_id uuid, p_filter jsonb)
 RETURNS TABLE(source_type text, source_ref_id uuid, full_name text, phone text, email text, contact_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := COALESCE(p_filter->>'audience_kind', 'members');
  v_status text := COALESCE(p_filter->>'member_status', 'all');
  v_categories text[];
  v_source_types text[];
  v_tags text[];
  v_lead_status text[];
  v_staff_roles text[];
  v_today date := CURRENT_DATE;
BEGIN
  v_categories   := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'categories')), '{}');
  v_source_types := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'source_types')), '{}');
  v_tags         := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'tags')), '{}');
  v_lead_status  := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'lead_status')), '{}');
  v_staff_roles  := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'staff_roles')), '{}');

  IF v_kind = 'segment' AND (p_filter->>'segment_id') IS NOT NULL THEN
    RETURN QUERY
      SELECT * FROM public.resolve_campaign_audience(
        p_branch_id,
        (SELECT filter FROM public.contact_segments WHERE id = (p_filter->>'segment_id')::uuid)
      );
    RETURN;
  END IF;

  IF v_kind IN ('members','mixed') THEN
    RETURN QUERY
      SELECT 'member'::text, m.id, p.full_name, p.phone, p.email, c.id
      FROM public.members m
      JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.contacts c ON c.source_type='member' AND c.source_id=m.id
      WHERE m.branch_id = p_branch_id
        AND (v_status='all'
             OR (v_status='active'  AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id=m.id AND ms.status='active' AND ms.end_date >= v_today))
             OR (v_status='expired' AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id=m.id AND ms.end_date <  v_today)));
  END IF;

  IF v_kind IN ('leads','mixed') THEN
    RETURN QUERY
      SELECT 'lead'::text, l.id, l.full_name, l.phone, l.email, c.id
      FROM public.leads l
      LEFT JOIN public.contacts c ON c.source_type='lead' AND c.source_id=l.id
      WHERE l.branch_id = p_branch_id
        AND (cardinality(v_lead_status)=0 OR l.status::text = ANY(v_lead_status));
  END IF;

  IF v_kind IN ('contacts','mixed') THEN
    RETURN QUERY
      SELECT 'contact'::text, c.id, c.full_name, c.phone, c.email, c.id
      FROM public.contacts c
      WHERE c.branch_id = p_branch_id
        AND (cardinality(v_categories)=0 OR c.category = ANY(v_categories))
        AND (cardinality(v_source_types)=0 OR c.source_type = ANY(v_source_types))
        AND (cardinality(v_tags)=0 OR c.tags && v_tags);
  END IF;

  IF v_kind IN ('staff','mixed') THEN
    RETURN QUERY
      SELECT DISTINCT 'staff'::text, p.id, p.full_name, p.phone, p.email, NULL::uuid
      FROM public.employees e
      JOIN public.profiles p ON p.id = e.user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE e.branch_id = p_branch_id
        AND e.is_active = true
        AND (cardinality(v_staff_roles)=0 OR ur.role::text = ANY(v_staff_roles));

    RETURN QUERY
      SELECT DISTINCT 'staff'::text, p.id, p.full_name, p.phone, p.email, NULL::uuid
      FROM public.trainers t
      JOIN public.profiles p ON p.id = t.user_id
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE t.branch_id = p_branch_id
        AND t.is_active = true
        AND (cardinality(v_staff_roles)=0 OR ur.role::text = ANY(v_staff_roles));

    IF cardinality(v_staff_roles)=0
       OR 'owner' = ANY(v_staff_roles)
       OR 'admin' = ANY(v_staff_roles) THEN
      RETURN QUERY
        SELECT DISTINCT 'staff'::text, p.id, p.full_name, p.phone, p.email, NULL::uuid
        FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE ur.role::text IN ('owner','admin')
          AND (cardinality(v_staff_roles)=0 OR ur.role::text = ANY(v_staff_roles));
    END IF;
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(uuid, jsonb) TO authenticated;