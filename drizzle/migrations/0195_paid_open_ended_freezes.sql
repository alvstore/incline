ALTER TABLE public.membership_freeze_history DROP CONSTRAINT freeze_duration_shape;
ALTER TABLE public.membership_freeze_history ADD CONSTRAINT freeze_duration_shape CHECK (
 (is_open_ended AND end_date IS NULL AND days_frozen IS NULL AND ((mode='override' AND COALESCE(fee_charged,0)=0) OR (mode='paid' AND fee_charged>0)))
 OR (NOT is_open_ended AND end_date IS NOT NULL AND days_frozen BETWEEN 1 AND 365));
COMMENT ON COLUMN public.membership_freeze_history.is_open_ended IS 'Until manual resume; no automatic expiry, no plan allowance deduction. Allowed for fee-free exceptions or flat-fee paid freezes; gated by branch freeze_exceptions_enabled.';
DO $$ DECLARE f text; BEGIN
 f:=pg_get_functiondef('public._apply_membership_freeze(uuid)'::regprocedure);
 f:=replace(f,'IF h.is_open_ended AND (h.mode<>''override'' OR h.days_frozen IS NOT NULL OR h.end_date IS NOT NULL OR COALESCE(h.fee_charged,0)<>0) THEN RAISE EXCEPTION ''Open-ended freezes require a fee-free management exception''; END IF;',
  'IF h.is_open_ended AND (h.days_frozen IS NOT NULL OR h.end_date IS NOT NULL OR NOT ((h.mode=''override'' AND COALESCE(h.fee_charged,0)=0) OR (h.mode=''paid'' AND COALESCE(h.fee_charged,0)>0))) THEN RAISE EXCEPTION ''Open-ended freezes must be a fee-free exception or a paid freeze''; END IF;');
 f:=replace(f,'IF h.mode<>''override'' AND (h.days_frozen<','IF h.mode<>''override'' AND NOT h.is_open_ended AND (h.days_frozen<');
 IF position('a paid freeze' in f)=0 THEN RAISE EXCEPTION '_apply patch failed'; END IF;
 EXECUTE f;
 f:=pg_get_functiondef('public.request_or_freeze_membership(uuid,integer,text,text,date,numeric,boolean)'::regprocedure);
 f:=replace(f,'(p_freeze_days IS NULL AND p_mode<>''override'')','(p_freeze_days IS NULL AND p_mode=''plan'')');
 f:=replace(f,'IF p_mode<>''override'' AND (p_freeze_days<','IF p_mode<>''override'' AND p_freeze_days IS NOT NULL AND (p_freeze_days<');
 IF position('p_mode=''plan'')' in f)=0 THEN RAISE EXCEPTION 'request patch failed'; END IF;
 EXECUTE f;
END $$;