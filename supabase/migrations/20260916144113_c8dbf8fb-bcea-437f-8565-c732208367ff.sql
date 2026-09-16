CREATE OR REPLACE FUNCTION public.safe_benefit_enum(p_code text)
RETURNS public.benefit_type
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_code text := lower(btrim(coalesce(p_code, '')));
BEGIN
  -- Known catalogue-code aliases that do not literally match the enum labels.
  v_code := CASE
    WHEN v_code LIKE 'steam%'        THEN 'steam_access'
    WHEN v_code LIKE 'sauna%'        THEN 'sauna_access'
    WHEN v_code LIKE 'ice_bath%'     THEN 'ice_bath'
    WHEN v_code LIKE 'locker%'       THEN 'locker'
    WHEN v_code LIKE '%body_scan%'   THEN 'body_scan'
    WHEN v_code LIKE '%posture%'     THEN 'posture_scan'
    WHEN v_code LIKE 'pool%'         THEN 'pool_access'
    ELSE v_code
  END;
  RETURN v_code::public.benefit_type;
EXCEPTION WHEN OTHERS THEN
  RETURN 'other'::public.benefit_type;
END;
$$;

-- Repair steam-room slots that were stored as the generic 'other' type.
UPDATE public.benefit_slots
   SET benefit_type = 'steam_access'
 WHERE benefit_type_id = '60df5f6a-2fe1-4911-b6a3-f5076511fe3a'
   AND benefit_type <> 'steam_access';

-- Repair plan entitlements for the steam room stored as 'other'.
UPDATE public.plan_benefits
   SET benefit_type = 'steam_access'
 WHERE benefit_type_id = '60df5f6a-2fe1-4911-b6a3-f5076511fe3a'
   AND benefit_type <> 'steam_access';

UPDATE public.benefit_usage
   SET benefit_type = 'steam_access'
 WHERE benefit_type_id = '60df5f6a-2fe1-4911-b6a3-f5076511fe3a'
   AND benefit_type <> 'steam_access';

UPDATE public.member_benefit_credits
   SET benefit_type = 'steam_access'
 WHERE benefit_type_id = '60df5f6a-2fe1-4911-b6a3-f5076511fe3a'
   AND benefit_type <> 'steam_access';