
ALTER TABLE public.howbody_scan_sessions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'body';

ALTER TABLE public.howbody_scan_sessions
  DROP CONSTRAINT IF EXISTS howbody_scan_sessions_kind_check;
ALTER TABLE public.howbody_scan_sessions
  ADD CONSTRAINT howbody_scan_sessions_kind_check CHECK (kind IN ('body','posture'));

CREATE TABLE IF NOT EXISTS public.howbody_scan_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_key text NOT NULL UNIQUE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('body','posture')),
  source text NOT NULL CHECK (source IN ('plan','credit','none')),
  credit_id uuid REFERENCES public.member_benefit_credits(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.howbody_scan_consumptions TO authenticated;
GRANT ALL ON public.howbody_scan_consumptions TO service_role;

ALTER TABLE public.howbody_scan_consumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view scan consumptions"
  ON public.howbody_scan_consumptions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = howbody_scan_consumptions.member_id
        AND m.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_howbody_scan_consumptions_member
  ON public.howbody_scan_consumptions(member_id, kind);

-- Atomic, idempotent scan consumption: plan allowance first, then FIFO add-on credit.
CREATE OR REPLACE FUNCTION public.howbody_consume_scan(
  _member_id uuid,
  _kind text,
  _data_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.howbody_scan_consumptions%ROWTYPE;
  v_quota jsonb;
  v_credit_id uuid;
  v_code text := CASE WHEN _kind = 'posture' THEN 'howbody_posture' ELSE '3d_body_scanning' END;
  v_source text;
BEGIN
  IF _data_key IS NULL OR length(trim(_data_key)) = 0 THEN
    RAISE EXCEPTION 'data_key is required';
  END IF;

  SELECT * INTO v_existing
    FROM public.howbody_scan_consumptions
   WHERE data_key = _data_key
   FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object('consumed', false, 'duplicate', true, 'source', v_existing.source);
  END IF;

  v_quota := public.howbody_scan_quota(_member_id, _kind);

  IF COALESCE((v_quota->>'plan_remaining')::int, 0) > 0 THEN
    v_source := 'plan';
  ELSE
    SELECT mbc.id INTO v_credit_id
      FROM public.member_benefit_credits mbc
      JOIN public.benefit_types bt ON bt.id = mbc.benefit_type_id
     WHERE mbc.member_id = _member_id
       AND bt.code = v_code
       AND mbc.credits_remaining > 0
       AND (mbc.expires_at IS NULL OR mbc.expires_at > now())
     ORDER BY COALESCE(mbc.expires_at, 'infinity'::timestamptz) ASC, mbc.purchased_at ASC
     LIMIT 1
     FOR UPDATE;

    IF v_credit_id IS NOT NULL THEN
      UPDATE public.member_benefit_credits
         SET credits_remaining = credits_remaining - 1,
             updated_at = now()
       WHERE id = v_credit_id;
      v_source := 'credit';
    ELSE
      v_source := 'none';
    END IF;
  END IF;

  INSERT INTO public.howbody_scan_consumptions (data_key, member_id, kind, source, credit_id)
  VALUES (_data_key, _member_id, _kind, v_source, v_credit_id)
  ON CONFLICT (data_key) DO NOTHING;

  RETURN jsonb_build_object(
    'consumed', v_source <> 'none',
    'duplicate', false,
    'source', v_source,
    'credit_id', v_credit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.howbody_consume_scan(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.howbody_consume_scan(uuid, text, text) TO service_role;

-- Device authorization check: known-but-disabled devices are rejected.
CREATE OR REPLACE FUNCTION public.howbody_device_authorized(_equipment_no text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT d.is_active FROM public.howbody_devices d WHERE d.equipment_no = _equipment_no),
    true
  );
$$;

REVOKE ALL ON FUNCTION public.howbody_device_authorized(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.howbody_device_authorized(text) TO authenticated, service_role;
