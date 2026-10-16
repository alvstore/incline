CREATE OR REPLACE FUNCTION public.set_invoice_due_date(p_invoice_id uuid, p_due_date date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_inv public.invoices%ROWTYPE;
  v_actor_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_capability(v_actor, 'approve_discount') THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only owners/admins/managers may change due dates' USING ERRCODE = '42501';
  END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'DUE_DATE_REQUIRED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.status = 'cancelled'::public.invoice_status THEN
    RAISE EXCEPTION 'CANNOT_SET_DUE_DATE_ON_CANCELLED_INVOICE' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoices SET payment_due_date = p_due_date, due_date = p_due_date,
         next_reminder_at = NULL, updated_at = now() WHERE id = p_invoice_id;
  BEGIN
    SELECT NULLIF(full_name,'') INTO v_actor_name FROM public.profiles WHERE id = v_actor;
    INSERT INTO public.audit_logs (user_id, actor_name, action, table_name, record_id, branch_id, old_data, new_data, action_description)
    VALUES (v_actor, COALESCE(v_actor_name,'System'), 'invoice_due_date_set', 'invoices', p_invoice_id, v_inv.branch_id,
      jsonb_build_object('due_date', v_inv.due_date, 'payment_due_date', v_inv.payment_due_date),
      jsonb_build_object('due_date', p_due_date, 'payment_due_date', p_due_date, 'reason', p_reason),
      'Due date for invoice ' || COALESCE(v_inv.invoice_number,'') || ' set to ' || p_due_date::text || COALESCE(': ' || NULLIF(trim(p_reason),''), ''));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  -- Re-check gate access immediately so a future due date unlocks the door.
  IF v_inv.member_id IS NOT NULL THEN
    BEGIN
      PERFORM public.evaluate_member_access_state(v_inv.member_id, v_actor, 'invoice_due_date_set', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_error_event('error', 'set_invoice_due_date', SQLERRM, NULL, jsonb_build_object('invoice_id', p_invoice_id));
    END;
  END IF;
  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'due_date', p_due_date);
END;
$function$;