CREATE OR REPLACE FUNCTION public.trg_payment_status_reverse_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.status::text,'') IN ('refunded','voided','cancelled','failed')
     AND COALESCE(OLD.status::text,'') NOT IN ('refunded','voided','cancelled','failed') THEN
    PERFORM public.reverse_trainer_commission(NEW.id, COALESCE(NEW.status::text,'voided'));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','trigger',SQLERRM,'trg_payment_status_reverse_commission',NULL,'payments',NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('payment_id',NEW.id));
  RETURN NEW;
END;
$function$;