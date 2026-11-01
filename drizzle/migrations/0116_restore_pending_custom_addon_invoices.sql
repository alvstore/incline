DO $migration$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.purchase_custom_benefit_credits(uuid,uuid,uuid,uuid,integer,numeric,boolean,numeric,integer,boolean,text,uuid,text,text)'::regprocedure) INTO v_def;
  IF position('IF v_total > 0 THEN' in v_def) = 0 OR position('ELSIF v_total = 0' in v_def) > 0 THEN RAISE EXCEPTION 'Unexpected add-on settlement definition'; END IF;
  v_def := replace(v_def, '''cash'',''card'',''bank_transfer'',''wallet'',''upi'',''cheque'',''other'')', '''cash'',''card'',''bank_transfer'',''wallet'',''upi'',''cheque'',''other'',''pending'')');
  v_def := replace(v_def, 'IF v_total > 0 THEN', 'IF v_total > 0 AND p_payment_method <> ''pending'' THEN');
  v_def := replace(v_def, '  ELSE' || chr(10) || '    UPDATE public.invoices SET status = ''paid''', '  ELSIF v_total = 0 THEN' || chr(10) || '    UPDATE public.invoices SET status = ''paid''');
  EXECUTE v_def;
END $migration$;