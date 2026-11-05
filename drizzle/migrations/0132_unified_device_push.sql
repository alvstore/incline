ALTER TABLE public.web_push_subscriptions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'web';
ALTER TABLE public.web_push_subscriptions ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.web_push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE public.web_push_subscriptions ALTER COLUMN auth_key DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='web_push_subscriptions_kind_chk') THEN
    ALTER TABLE public.web_push_subscriptions ADD CONSTRAINT web_push_subscriptions_kind_chk
      CHECK (kind IN ('web','fcm') AND (kind='fcm' OR (p256dh IS NOT NULL AND auth_key IS NOT NULL)));
  END IF;
END $$;
COMMENT ON TABLE public.web_push_subscriptions IS 'Unified device push registry: browser (kind=web) and Flutter/FCM (kind=fcm, endpoint=fcm:<token>). One queue, one worker (web-push).';