DO $migration$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('public.closeout_pt_invoice(uuid,text,numeric,numeric,numeric,boolean)'::regprocedure) INTO v_definition;
 v_definition := replace(v_definition, 'WHERE member_package_id=v_pkg.id', 'WHERE member_pt_package_id=v_pkg.id');
 v_definition := replace(v_definition, ' v_snapshot:=', E' IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE invoice_id=p_invoice_id AND status IN (\'created\',\'pending_confirmation\')) THEN RAISE EXCEPTION \'pending_gateway_payment\' USING ERRCODE=\'22023\'; END IF;\n v_snapshot:=');
 EXECUTE v_definition;
END;
$migration$;