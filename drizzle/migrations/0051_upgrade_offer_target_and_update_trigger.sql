CREATE OR REPLACE FUNCTION public.tg_create_upgrade_offer()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan RECORD;
  v_annual RECORD;
  v_target uuid;
BEGIN
  -- guard-exempt: trigger function, never called directly by users
  IF NEW.status IS DISTINCT FROM 'active' AND NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  SELECT duration_days INTO v_plan FROM public.membership_plans WHERE id = NEW.plan_id;
  IF v_plan.duration_days IS NULL OR v_plan.duration_days NOT IN (30, 90, 180) THEN
    RETURN NEW;
  END IF;

  -- Explicit target: settings key 'annual_upgrade_target_plan_id' (branch row, then global).
  SELECT NULLIF(trim(both '"' from s.value::text), '')::uuid INTO v_target
    FROM public.settings s
   WHERE s.key = 'annual_upgrade_target_plan_id'
     AND (s.branch_id = NEW.branch_id OR s.branch_id IS NULL)
   ORDER BY (s.branch_id IS NULL)
   LIMIT 1;

  SELECT id, COALESCE(discounted_price, price) AS annual_price
    INTO v_annual
    FROM public.membership_plans
   WHERE duration_days = 365 AND is_active = true
     AND (branch_id = NEW.branch_id OR branch_id IS NULL)
     AND (v_target IS NULL OR id = v_target)
   ORDER BY COALESCE(discounted_price, price) ASC, created_at
   LIMIT 1;

  IF v_annual.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.upgrade_offers (
    branch_id, member_id, membership_id, target_plan_id,
    window_ends_at, annual_price, already_paid, upgrade_cost
  ) VALUES (
    NEW.branch_id, NEW.member_id, NEW.id, v_annual.id,
    (NEW.start_date + 15)::timestamptz,
    v_annual.annual_price,
    COALESCE(NEW.price_paid, 0),
    GREATEST(COALESCE(v_annual.annual_price, 0) - COALESCE(NEW.price_paid, 0), 0)
  )
  ON CONFLICT (membership_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tg_create_upgrade_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_memberships_upgrade_offer_update ON public.memberships;
CREATE TRIGGER trg_memberships_upgrade_offer_update
  AFTER UPDATE OF plan_id, start_date, status ON public.memberships
  FOR EACH ROW
  WHEN (OLD.plan_id IS DISTINCT FROM NEW.plan_id OR OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_create_upgrade_offer();