-- 1) Custom terms column on onboarding signatures
ALTER TABLE public.member_onboarding_signatures
  ADD COLUMN IF NOT EXISTS custom_terms text;

-- 2) Backfill profiles.avatar_url from members.biometric_photo_url where possible
UPDATE public.profiles p
SET avatar_url = m.biometric_photo_url,
    updated_at = now()
FROM public.members m
WHERE m.user_id = p.id
  AND m.biometric_photo_url IS NOT NULL
  AND (p.avatar_url IS NULL OR p.avatar_url = '');