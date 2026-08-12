ALTER TABLE public.mips_device_face_state DROP CONSTRAINT IF EXISTS mips_device_face_state_state_check;
ALTER TABLE public.mips_device_face_state ADD CONSTRAINT mips_device_face_state_state_check
  CHECK (state = ANY (ARRAY['pending'::text,'enrolled'::text,'rejected'::text,'missing'::text,'unverified'::text]));

-- One-time repair: rows flipped to enrolled by the blanket parity shortcut
-- (no per-person push ever proved them) become honestly "unverified".
UPDATE public.mips_device_face_state
SET state = 'unverified',
    reason = 'Counted on the gate but never attributed to this person',
    enrolled_at = NULL
WHERE state = 'enrolled'
  AND (last_attempt_at IS NULL OR enrolled_at IS NULL OR enrolled_at > last_attempt_at + interval '1 minute');