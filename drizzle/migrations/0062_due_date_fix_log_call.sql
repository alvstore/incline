DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.set_invoice_due_date(uuid,date,text)'::regprocedure) INTO d;
 d := replace(d, $r$PERFORM public.log_error_event('error', 'set_invoice_due_date', SQLERRM, NULL, jsonb_build_object('invoice_id', p_invoice_id));$r$,
   $r$BEGIN PERFORM public.log_error_event(p_severity => 'error', p_source => 'set_invoice_due_date', p_message => SQLERRM, p_context => jsonb_build_object('invoice_id', p_invoice_id)); EXCEPTION WHEN OTHERS THEN NULL; END;$r$);
 EXECUTE d; END $$;