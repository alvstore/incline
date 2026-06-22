UPDATE public.ai_dynamic_memory
SET correction_instruction = 'We''re at Sector 14, Udaipur, Rajasthan ✨',
    updated_at = now()
WHERE intent_category = 'location';

UPDATE public.ai_dynamic_memory
SET correction_instruction = 'Founding Member (Annual) is our only active enrollment right now — full pricing is shared by our team once you''re on the Founder''s list ✨',
    updated_at = now()
WHERE intent_category = 'pricing';

UPDATE public.ai_dynamic_memory
SET correction_instruction = 'Our opening date hasn''t been announced publicly yet — Founding Members will be the first to know ✨',
    updated_at = now()
WHERE intent_category = 'timeline';

CREATE OR REPLACE FUNCTION public.tg_ai_dynamic_memory_sanitize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta_prefix TEXT  := '^\s*(location|pricing|timeline|opening|launch|intent)\s+intent\s*[—\-:]\s*';
  v_instr_prefix TEXT := '^\s*(share|tell|reply|say|mention|use|send|give|provide|inform|respond|answer|state|note|please)\M[^:\n]{0,80}:\s*';
  v_canonical TEXT;
BEGIN
  IF NEW.correction_instruction IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.correction_instruction := regexp_replace(NEW.correction_instruction, v_meta_prefix, '', 'i');
  NEW.correction_instruction := regexp_replace(NEW.correction_instruction, v_instr_prefix, '', 'i');
  NEW.correction_instruction := btrim(NEW.correction_instruction);

  IF NEW.correction_instruction = ''
     OR NEW.correction_instruction ~* v_meta_prefix
     OR NEW.correction_instruction ~* v_instr_prefix THEN
    v_canonical := CASE NEW.intent_category
      WHEN 'location' THEN 'We''re at Sector 14, Udaipur, Rajasthan ✨'
      WHEN 'pricing'  THEN 'Founding Member (Annual) is our only active enrollment right now — full pricing is shared by our team once you''re on the Founder''s list ✨'
      WHEN 'timeline' THEN 'Our opening date hasn''t been announced publicly yet — Founding Members will be the first to know ✨'
      ELSE NULL
    END;
    IF v_canonical IS NOT NULL THEN
      NEW.correction_instruction := v_canonical;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_ai_dynamic_memory_sanitize ON public.ai_dynamic_memory;
CREATE TRIGGER tg_ai_dynamic_memory_sanitize
BEFORE INSERT OR UPDATE OF correction_instruction, intent_category
ON public.ai_dynamic_memory
FOR EACH ROW
EXECUTE FUNCTION public.tg_ai_dynamic_memory_sanitize();