
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_meta JSONB;

DROP POLICY IF EXISTS "wa media read for authenticated" ON storage.objects;
CREATE POLICY "wa media read for authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'whatsapp-media');

DROP POLICY IF EXISTS "wa media insert for authenticated" ON storage.objects;
CREATE POLICY "wa media insert for authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-media');
