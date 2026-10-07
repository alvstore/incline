-- Public buckets serve files by public URL without a SELECT policy.
-- Replace broad "anyone can list" SELECT policies with uploader-scoped ones (keeps upsert working).
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "avatars_meta_public_read" ON storage.objects;
DROP POLICY IF EXISTS "Product images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public can view ad banners" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for org-assets" ON storage.objects;
DROP POLICY IF EXISTS "template_media_public_read" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read workout videos" ON storage.objects;

CREATE POLICY "avatars_owner_or_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND (owner = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])));
CREATE POLICY "products_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'products' AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]));
CREATE POLICY "ad_banners_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ad-banners' AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]));
CREATE POLICY "org_assets_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'org-assets' AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]));
CREATE POLICY "template_media_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'template-media' AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]));
CREATE POLICY "workout_videos_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'workout-videos' AND public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[]));