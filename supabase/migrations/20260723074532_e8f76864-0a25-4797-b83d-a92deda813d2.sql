-- 1) Let members see the organisation logo + name (they were blocked before,
--    so the sidebar/dashboard fell back to a placeholder).
DROP POLICY IF EXISTS "Any authenticated user can view org branding"
  ON public.organization_settings;
CREATE POLICY "Any authenticated user can view org branding"
  ON public.organization_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- 2) When a user updates their avatar via profile edit, mirror it into
--    members.biometric_photo_url when the member hasn't uploaded a dedicated
--    biometric shot yet — that column is what sync-to-mips reads first, so
--    hardware finally sees the new face after the next sync.
CREATE OR REPLACE FUNCTION public.mirror_profile_avatar_to_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
     AND NEW.avatar_url IS NOT NULL
     AND length(NEW.avatar_url) > 0 THEN
    UPDATE public.members
       SET biometric_photo_url = NEW.avatar_url
     WHERE user_id = NEW.id
       AND (biometric_photo_url IS NULL
            OR biometric_photo_url = ''
            OR biometric_photo_url = OLD.avatar_url);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_mirror_profile_avatar_to_member ON public.profiles;
CREATE TRIGGER tg_mirror_profile_avatar_to_member
AFTER UPDATE OF avatar_url ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.mirror_profile_avatar_to_member();