
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_reason text,
  ADD COLUMN IF NOT EXISTS in_window boolean,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_label text;

-- Allow new source_type values (lost_lead, csv); drop old check
ALTER TABLE public.campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_source_type_check;
ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_source_type_check
  CHECK (source_type = ANY (ARRAY['member','lead','contact','lost_lead','csv']));

-- Allow source_ref_id to be NULL for CSV imports (no DB row to point to)
ALTER TABLE public.campaign_recipients ALTER COLUMN source_ref_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_error_code
  ON public.campaign_recipients(campaign_id, error_code) WHERE error_code IS NOT NULL;

-- v2 resolver: same shape + in_window + source_label, supports lost_leads
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience_v2(
  p_branch_id uuid,
  p_filter jsonb,
  p_window_hours int DEFAULT 24
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
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := COALESCE(p_filter->>'audience_kind', 'members');
  v_status text := COALESCE(p_filter->>'member_status', 'all');
  v_lead_status text[];
  v_today date := CURRENT_DATE;
  v_window_start timestamptz := now() - make_interval(hours => p_window_hours);
BEGIN
  v_lead_status := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filter->'lead_status')), '{}');

  -- segment passthrough
  IF v_kind = 'segment' AND (p_filter->>'segment_id') IS NOT NULL THEN
    RETURN QUERY
      SELECT * FROM public.resolve_campaign_audience_v2(
        p_branch_id,
        (SELECT filter FROM public.contact_segments WHERE id = (p_filter->>'segment_id')::uuid),
        p_window_hours
      );
    RETURN;
  END IF;

  -- members
  IF v_kind IN ('members','mixed') THEN
    RETURN QUERY
      SELECT
        'member'::text,
        m.id,
        p.full_name,
        p.phone,
        p.email,
        c.id,
        EXISTS(
          SELECT 1 FROM public.whatsapp_messages w
          WHERE w.phone_number = p.phone
            AND w.direction = 'inbound'
            AND w.created_at >= v_window_start
        ),
        'Member'::text
      FROM public.members m
      JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.contacts c ON c.source_type='member' AND c.source_id=m.id
      WHERE m.branch_id = p_branch_id
        AND p.phone IS NOT NULL
        AND (v_status='all'
             OR (v_status='active'  AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id=m.id AND ms.status='active' AND ms.end_date >= v_today))
             OR (v_status='expired' AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id=m.id AND ms.end_date <  v_today)));
  END IF;

  -- leads (excluding lost when lost_leads kind handled separately)
  IF v_kind IN ('leads','mixed') THEN
    RETURN QUERY
      SELECT
        'lead'::text, l.id, l.full_name, l.phone, l.email, c.id,
        EXISTS(
          SELECT 1 FROM public.whatsapp_messages w
          WHERE w.phone_number = l.phone
            AND w.direction = 'inbound'
            AND w.created_at >= v_window_start
        ),
        'Lead'::text
      FROM public.leads l
      LEFT JOIN public.contacts c ON c.source_type='lead' AND c.source_id=l.id
      WHERE l.branch_id = p_branch_id
        AND l.phone IS NOT NULL
        AND COALESCE(l.status::text, 'new') <> 'lost'
        AND (cardinality(v_lead_status)=0 OR l.status::text = ANY(v_lead_status));
  END IF;

  -- lost leads
  IF v_kind IN ('lost_leads','mixed') THEN
    RETURN QUERY
      SELECT
        'lost_lead'::text, l.id, l.full_name, l.phone, l.email, c.id,
        EXISTS(
          SELECT 1 FROM public.whatsapp_messages w
          WHERE w.phone_number = l.phone
            AND w.direction = 'inbound'
            AND w.created_at >= v_window_start
        ),
        'Lost lead'::text
      FROM public.leads l
      LEFT JOIN public.contacts c ON c.source_type='lead' AND c.source_id=l.id
      WHERE l.branch_id = p_branch_id
        AND l.phone IS NOT NULL
        AND (
          l.status::text = 'lost'
          OR (l.last_contacted_at IS NOT NULL AND l.last_contacted_at < now() - interval '60 days')
        );
  END IF;

  -- contacts
  IF v_kind IN ('contacts','mixed') THEN
    RETURN QUERY
      SELECT
        'contact'::text, c.id, c.full_name, c.phone, c.email, c.id,
        EXISTS(
          SELECT 1 FROM public.whatsapp_messages w
          WHERE w.phone_number = c.phone
            AND w.direction = 'inbound'
            AND w.created_at >= v_window_start
        ),
        'Contact'::text
      FROM public.contacts c
      WHERE c.branch_id = p_branch_id
        AND c.phone IS NOT NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience_v2(uuid, jsonb, int) TO authenticated;
