CREATE OR REPLACE FUNCTION public.search_command_invoices(search_term text, p_branch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, invoice_number text, status text, total_amount numeric, amount_paid numeric, member_id uuid, member_name text, branch_id uuid, branch_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_term text := COALESCE(NULLIF(trim(search_term), ''), '');
  v_member_only boolean := public.has_role(v_uid, 'member'::app_role)
                            AND NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff','trainer']::app_role[]);
BEGIN
  IF v_uid IS NULL OR length(v_term) < 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT i.id, i.invoice_number, i.status::text, i.total_amount, i.amount_paid, i.member_id,
         p.full_name AS member_name, i.branch_id, b.name AS branch_name
  FROM public.invoices i
  LEFT JOIN public.members m ON m.id = i.member_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN public.branches b ON b.id = i.branch_id
  WHERE (
          (v_member_only AND m.user_id = v_uid)
          OR (
            NOT v_member_only
            AND i.branch_id IN (SELECT v.branch_id FROM public.user_visible_branches(v_uid) v)
            AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
          )
        )
    AND (
      COALESCE(i.invoice_number, '') ILIKE '%' || v_term || '%'
      OR p.full_name ILIKE '%' || v_term || '%'
      OR m.member_code ILIKE '%' || v_term || '%'
    )
  ORDER BY i.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 25));
END;
$function$;