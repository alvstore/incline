CREATE OR REPLACE FUNCTION public.tg_notify_member_on_benefit_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_branch_id uuid;
BEGIN
  SELECT user_id, branch_id INTO v_user_id, v_branch_id
    FROM public.members WHERE id = NEW.member_id;

  IF v_user_id IS NOT NULL THEN
    BEGIN
      PERFORM public.notify_member(
        v_user_id,
        v_branch_id,
        'Add-on credits added',
        COALESCE(NEW.credits_total, 0)::text || ' new benefit credits are available in your wallet.',
        'success',
        'benefits'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;