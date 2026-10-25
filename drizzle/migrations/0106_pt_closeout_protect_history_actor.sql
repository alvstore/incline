DO $migration$
DECLARE v_definition text; v_oid oid;
BEGIN
 SELECT pg_get_functiondef('public.closeout_pt_invoice(uuid,text,numeric,numeric,numeric,boolean)'::regprocedure) INTO v_definition;
 v_definition := replace(v_definition, 'INSERT INTO public.audit_logs(user_id,branch_id,action,table_name,record_id,old_data,new_data,action_description)', 'INSERT INTO public.audit_logs(user_id,actor_name,branch_id,action,table_name,record_id,old_data,new_data,action_description)');
 v_definition := replace(v_definition, 'VALUES(v_actor,v_inv.branch_id,', 'VALUES(v_actor,(SELECT full_name FROM public.profiles WHERE id=v_actor),v_inv.branch_id,');
 EXECUTE v_definition;
 -- A finalized closeout cannot subsequently void preserved receipts or change its reconciled totals.
 FOR v_oid IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('cancel_invoice','correct_invoice') LOOP
   SELECT pg_get_functiondef(v_oid) INTO v_definition;
   IF v_definition LIKE '%_invoice_id uuid%' AND v_definition LIKE '%public.cancel_invoice%' THEN
     v_definition := regexp_replace(v_definition, 'BEGIN', E'BEGIN\n IF EXISTS (SELECT 1 FROM public.pt_invoice_closeouts WHERE invoice_id=_invoice_id) THEN RAISE EXCEPTION \'closeout_finalized\' USING ERRCODE=\'22023\'; END IF;');
   ELSIF v_definition LIKE '%p_invoice_id uuid%' THEN
     v_definition := regexp_replace(v_definition, 'BEGIN', E'BEGIN\n IF EXISTS (SELECT 1 FROM public.pt_invoice_closeouts WHERE invoice_id=p_invoice_id) THEN RAISE EXCEPTION \'closeout_finalized\' USING ERRCODE=\'22023\'; END IF;');
   END IF;
   EXECUTE v_definition;
 END LOOP;
END;
$migration$;