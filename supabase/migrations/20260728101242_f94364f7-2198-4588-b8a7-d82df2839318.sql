
CREATE OR REPLACE FUNCTION public.mirror_profile_avatar_to_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
     AND NEW.avatar_url IS NOT NULL
     AND length(NEW.avatar_url) > 0 THEN
    UPDATE public.members m
       SET biometric_photo_url = NEW.avatar_url
     WHERE m.user_id = NEW.id
       AND (m.biometric_photo_path IS NULL OR btrim(m.biometric_photo_path) = '')
       AND (m.biometric_photo_url IS NULL
            OR m.biometric_photo_url = ''
            OR m.biometric_photo_url = OLD.avatar_url);
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.biometric_sync_queue
   SET status = 'pending',
       retry_count = 0,
       error_message = NULL,
       processed_at = NULL
 WHERE sync_type = 'photo_upload'
   AND status IN ('failed','processing')
   AND queued_at > now() - interval '30 days';
