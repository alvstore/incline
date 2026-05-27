
CREATE OR REPLACE FUNCTION public.normalize_phone_in(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  s := regexp_replace(p, '[^0-9+]', '', 'g');
  IF s = '' THEN RETURN NULL; END IF;
  IF left(s,1) = '+' THEN RETURN s; END IF;
  IF length(s) = 13 AND left(s,3) = '091' THEN RETURN '+' || substring(s from 2); END IF;
  IF length(s) = 11 AND left(s,1) = '0' AND substring(s from 2 for 1) ~ '[6-9]' THEN
    RETURN '+91' || substring(s from 2);
  END IF;
  IF length(s) = 10 AND s ~ '^[6-9]' THEN RETURN '+91' || s; END IF;
  IF length(s) = 12 AND left(s,2) = '91' THEN RETURN '+' || s; END IF;
  RETURN '+' || s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_normalize_phone_col()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN NEW.phone := public.normalize_phone_in(NEW.phone); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.tg_normalize_phone_number_col()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN NEW.phone_number := public.normalize_phone_in(NEW.phone_number); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS profiles_normalize_phone_trg ON public.profiles;
CREATE TRIGGER profiles_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_col();
DROP TRIGGER IF EXISTS leads_normalize_phone_trg ON public.leads;
CREATE TRIGGER leads_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_col();
DROP TRIGGER IF EXISTS branches_normalize_phone_trg ON public.branches;
CREATE TRIGGER branches_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_col();
DROP TRIGGER IF EXISTS sms_logs_normalize_phone_trg ON public.sms_logs;
CREATE TRIGGER sms_logs_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.sms_logs FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_col();
DROP TRIGGER IF EXISTS campaign_recipients_normalize_phone_trg ON public.campaign_recipients;
CREATE TRIGGER campaign_recipients_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.campaign_recipients FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_col();
DROP TRIGGER IF EXISTS otp_verifications_normalize_phone_trg ON public.otp_verifications;
CREATE TRIGGER otp_verifications_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.otp_verifications FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_col();
DROP TRIGGER IF EXISTS whatsapp_chat_settings_normalize_phone_trg ON public.whatsapp_chat_settings;
CREATE TRIGGER whatsapp_chat_settings_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.whatsapp_chat_settings FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_number_col();
DROP TRIGGER IF EXISTS whatsapp_messages_normalize_phone_trg ON public.whatsapp_messages;
CREATE TRIGGER whatsapp_messages_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_number_col();
DROP TRIGGER IF EXISTS whatsapp_conversation_state_normalize_phone_trg ON public.whatsapp_conversation_state;
CREATE TRIGGER whatsapp_conversation_state_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.whatsapp_conversation_state FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_number_col();
DROP TRIGGER IF EXISTS whatsapp_send_locks_normalize_phone_trg ON public.whatsapp_send_locks;
CREATE TRIGGER whatsapp_send_locks_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.whatsapp_send_locks FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_number_col();
DROP TRIGGER IF EXISTS ai_tool_logs_normalize_phone_trg ON public.ai_tool_logs;
CREATE TRIGGER ai_tool_logs_normalize_phone_trg BEFORE INSERT OR UPDATE ON public.ai_tool_logs FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_number_col();

UPDATE public.profiles SET phone = public.normalize_phone_in(phone) WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
UPDATE public.leads SET phone = public.normalize_phone_in(phone) WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
UPDATE public.branches SET phone = public.normalize_phone_in(phone) WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
UPDATE public.sms_logs SET phone = public.normalize_phone_in(phone) WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
UPDATE public.campaign_recipients SET phone = public.normalize_phone_in(phone) WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
UPDATE public.otp_verifications SET phone = public.normalize_phone_in(phone) WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
UPDATE public.whatsapp_chat_settings SET phone_number = public.normalize_phone_in(phone_number) WHERE phone_number IS NOT NULL AND phone_number IS DISTINCT FROM public.normalize_phone_in(phone_number);
UPDATE public.whatsapp_messages SET phone_number = public.normalize_phone_in(phone_number) WHERE phone_number IS NOT NULL AND phone_number IS DISTINCT FROM public.normalize_phone_in(phone_number);
UPDATE public.whatsapp_conversation_state SET phone_number = public.normalize_phone_in(phone_number) WHERE phone_number IS NOT NULL AND phone_number IS DISTINCT FROM public.normalize_phone_in(phone_number);
UPDATE public.ai_tool_logs SET phone_number = public.normalize_phone_in(phone_number) WHERE phone_number IS NOT NULL AND phone_number IS DISTINCT FROM public.normalize_phone_in(phone_number);

CREATE OR REPLACE FUNCTION public.resolve_email_by_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_normalized text;
  v_user_id uuid;
  v_email text;
BEGIN
  v_normalized := public.normalize_phone_in(p_phone);
  IF v_normalized IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_user_id FROM public.profiles WHERE phone = v_normalized LIMIT 1;
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id LIMIT 1;
  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_email_by_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_email_by_phone(text) TO service_role;
