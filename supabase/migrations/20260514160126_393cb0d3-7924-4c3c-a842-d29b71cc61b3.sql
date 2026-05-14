CREATE TABLE public.lead_notification_admin_prefs (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_notification_admin_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/owners can view all admin notification prefs"
  ON public.lead_notification_admin_prefs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Owners can insert any admin notification prefs"
  ON public.lead_notification_admin_prefs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'::app_role) OR auth.uid() = user_id);

CREATE POLICY "Users can update their own prefs, owners any"
  ON public.lead_notification_admin_prefs FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::app_role) OR auth.uid() = user_id);

CREATE POLICY "Owners can delete admin notification prefs"
  ON public.lead_notification_admin_prefs FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::app_role));

CREATE TRIGGER update_lead_notification_admin_prefs_updated_at
  BEFORE UPDATE ON public.lead_notification_admin_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();