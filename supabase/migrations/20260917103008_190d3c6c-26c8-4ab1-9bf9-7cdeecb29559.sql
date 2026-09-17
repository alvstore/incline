
ALTER TABLE public.reminder_configurations
  ADD COLUMN IF NOT EXISTS fallback_channels text[] NOT NULL DEFAULT '{}'::text[];

-- Seed 7/5/3 cadence + multi-channel fallback for every active branch
INSERT INTO public.reminder_configurations (branch_id, reminder_type, is_enabled, days_before, channel, fallback_channels)
SELECT b.id, t.rtype, true, ARRAY[7,5,3], 'whatsapp', ARRAY['sms','email','notification']
FROM public.branches b
CROSS JOIN (VALUES ('membership_expiry'), ('payment_due')) AS t(rtype)
WHERE NOT EXISTS (
  SELECT 1 FROM public.reminder_configurations rc
  WHERE rc.branch_id = b.id AND rc.reminder_type = t.rtype
);

-- Renewal engine: 7/5/3 pre-expiry cadence
ALTER TABLE public.renewal_engine_config
  ALTER COLUMN stage_offsets SET DEFAULT ARRAY[-7,-5,-3,0,3,7],
  ADD COLUMN IF NOT EXISTS voice_auto_call_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_stage_offsets integer[] NOT NULL DEFAULT ARRAY[-3,0];

UPDATE public.renewal_engine_config SET stage_offsets = ARRAY[-7,-5,-3,0,3,7];

-- Security: staff-only read on WhatsApp recipient state
DROP POLICY IF EXISTS "Staff read recipient state in scope" ON public.whatsapp_recipient_state;
CREATE POLICY "Staff read recipient state in scope"
ON public.whatsapp_recipient_state
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role])
  AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
);
