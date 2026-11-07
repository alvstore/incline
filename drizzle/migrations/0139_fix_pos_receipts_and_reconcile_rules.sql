DO $mig$
DECLARE d text;
BEGIN
  -- 1) Store checkout: record a real receipt for paid sales; salary deductions stay receipt-free.
  d := pg_get_functiondef('public.create_pos_sale(uuid,uuid,jsonb,text,uuid,text,text,text,boolean,numeric,uuid,text,numeric,text,text,text,numeric,text)'::regprocedure);
  d := replace(d, $a$      CASE WHEN v_is_awaiting THEN 0 ELSE v_total END,
      CASE WHEN v_is_awaiting THEN 'pending'::invoice_status ELSE 'paid'::invoice_status END,$a$,
  $a$      CASE WHEN v_is_awaiting THEN 0
           WHEN p_transaction_id = 'SALARY-DEDUCTION' THEN v_total
           ELSE v_total - v_remainder END,
      CASE WHEN v_is_awaiting THEN 'pending'::invoice_status
           WHEN p_transaction_id = 'SALARY-DEDUCTION' OR v_remainder <= 0 THEN 'paid'::invoice_status
           WHEN v_total - v_remainder > 0 THEN 'partial'::invoice_status
           ELSE 'pending'::invoice_status END,$a$);
  d := replace(d, $a$    IF NOT v_is_awaiting AND v_remainder > 0 THEN
      PERFORM public.settle_payment($a$,
  $a$    IF NOT v_is_awaiting AND v_remainder > 0 AND COALESCE(p_transaction_id,'') <> 'SALARY-DEDUCTION' THEN
      v_settle := public.settle_payment($a$);
  d := replace(d, $a$|| ':remainder');
    END IF;$a$, $a$|| ':remainder');
      IF COALESCE((v_settle->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Payment failed: %', COALESCE(v_settle->>'error', 'payment declined');
      END IF;
    END IF;$a$);
  IF position('SALARY-DEDUCTION'' THEN v_total' in d) = 0 OR position('v_settle := public.settle_payment(
        p_branch_id := p_branch_id, p_invoice_id := v_invoice_id, p_member_id := p_member_id,
        p_amount := v_remainder' in d) = 0 THEN
    RAISE EXCEPTION 'create_pos_sale patch did not apply';
  END IF;
  EXECUTE d;

  -- 2) Stalled activation ignores future-dated memberships.
  d := pg_get_functiondef('public.reconcile_payments_daily()'::regprocedure);
  d := replace(d, $a$       AND COALESCE(i.amount_paid, 0) > 0
  LOOP$a$, $a$       AND COALESCE(i.amount_paid, 0) > 0
       AND (m.start_date IS NULL OR m.start_date <= v_run_date)
  LOOP$a$);
  d := replace(d, $a$         WHERE m.id = f.reference_id AND m.status = 'pending'::public.membership_status
      );$a$, $a$         WHERE m.id = f.reference_id AND m.status = 'pending'::public.membership_status
           AND (m.start_date IS NULL OR m.start_date <= v_run_date)
      );$a$);
  IF (length(d) - length(replace(d, 'm.start_date <= v_run_date', ''))) / length('m.start_date <= v_run_date') <> 2 THEN
    RAISE EXCEPTION 'reconcile patch did not apply';
  END IF;
  EXECUTE d;

  -- 3) Ledger check counts a linked salary deduction as settlement.
  d := pg_get_functiondef('public.recheck_invoice_reconciliation(uuid)'::regprocedure);
  d := replace(d, $a$  v_net_paid := v_paid - v_reversed;$a$, $a$  v_net_paid := v_paid - v_reversed;
  v_net_paid := v_net_paid + COALESCE((
    SELECT sa.amount FROM public.pos_sales ps
      JOIN public.salary_advances sa ON sa.id = ps.salary_advance_id
     WHERE ps.invoice_id = p_invoice_id AND ps.settlement = 'salary_deduction'
     LIMIT 1), 0);$a$);
  IF position('salary_deduction' in d) = 0 THEN RAISE EXCEPTION 'recheck patch did not apply'; END IF;
  EXECUTE d;
END
$mig$;