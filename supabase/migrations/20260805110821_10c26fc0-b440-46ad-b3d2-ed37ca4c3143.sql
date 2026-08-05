
CREATE OR REPLACE FUNCTION public.members_restorable_after_dues()
RETURNS TABLE(member_id uuid, member_code text, branch_id uuid, mips_person_sn text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT m.id, m.member_code, m.branch_id, m.mips_person_sn
  FROM public.members m
  WHERE m.hardware_access_status <> 'active'
    AND COALESCE(m.hardware_access_reason, '') IN ('dues', 'dues_cleared')
    AND m.mips_person_sn IS NOT NULL
    AND (public.member_access_status(m.id, m.branch_id) ->> 'allowed')::boolean IS TRUE
    AND EXISTS (
      SELECT 1 FROM public.memberships ms
      WHERE ms.member_id = m.id
        AND ms.status = 'active'
        AND ms.end_date >= current_date
    );
$fn$;
