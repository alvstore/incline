ALTER TABLE public.rcs_inbound_events
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rcs_inbound_branch ON public.rcs_inbound_events(branch_id);

CREATE OR REPLACE FUNCTION public.tg_rcs_inbound_resolve_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(NEW.sender_phone, ''), '\D', '', 'g');
  v_branch uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.message_id IS NOT NULL OR NEW.record_id IS NOT NULL THEN
    SELECT cl.branch_id INTO v_branch
      FROM public.communication_logs cl
     WHERE (NEW.message_id IS NOT NULL AND cl.provider_message_id = NEW.message_id)
        OR (NEW.record_id IS NOT NULL AND cl.provider_record_id = NEW.record_id)
     ORDER BY cl.created_at DESC
     LIMIT 1;
  END IF;

  IF v_branch IS NULL AND length(v_digits) >= 10 THEN
    SELECT m.branch_id INTO v_branch
      FROM public.members m
      JOIN public.profiles p ON p.id = m.user_id
     WHERE right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10)
     ORDER BY m.created_at DESC
     LIMIT 1;
  END IF;

  IF v_branch IS NULL AND length(v_digits) >= 10 THEN
    SELECT l.branch_id INTO v_branch
      FROM public.leads l
     WHERE right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10)
     ORDER BY l.created_at DESC
     LIMIT 1;
  END IF;

  NEW.branch_id := v_branch;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rcs_inbound_resolve_branch ON public.rcs_inbound_events;
CREATE TRIGGER trg_rcs_inbound_resolve_branch
BEFORE INSERT ON public.rcs_inbound_events
FOR EACH ROW EXECUTE FUNCTION public.tg_rcs_inbound_resolve_branch();

-- backfill existing rows
UPDATE public.rcs_inbound_events e
   SET branch_id = cl.branch_id
  FROM public.communication_logs cl
 WHERE e.branch_id IS NULL
   AND (
     (e.message_id IS NOT NULL AND cl.provider_message_id = e.message_id)
     OR (e.record_id IS NOT NULL AND cl.provider_record_id = e.record_id)
   );

UPDATE public.rcs_inbound_events e
   SET branch_id = m.branch_id
  FROM public.members m
  JOIN public.profiles p ON p.id = m.user_id
 WHERE e.branch_id IS NULL
   AND length(regexp_replace(COALESCE(e.sender_phone, ''), '\D', '', 'g')) >= 10
   AND right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10)
       = right(regexp_replace(e.sender_phone, '\D', '', 'g'), 10);

-- branch-scoped read access
DROP POLICY IF EXISTS "rcs_inbound_read_staff" ON public.rcs_inbound_events;

CREATE POLICY "rcs_inbound_read_admins" ON public.rcs_inbound_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rcs_inbound_read_branch_staff" ON public.rcs_inbound_events
  FOR SELECT TO authenticated
  USING (
    (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'staff'))
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );