ALTER TABLE public.members ADD COLUMN IF NOT EXISTS mips_face_verified_at timestamptz;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS mips_face_verified_at timestamptz;
ALTER TABLE public.trainers ADD COLUMN IF NOT EXISTS mips_face_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_members_mips_face_verified_at ON public.members (mips_face_verified_at NULLS FIRST) WHERE mips_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_mips_face_verified_at ON public.employees (mips_face_verified_at NULLS FIRST) WHERE mips_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trainers_mips_face_verified_at ON public.trainers (mips_face_verified_at NULLS FIRST) WHERE mips_person_id IS NOT NULL;

UPDATE public.automation_rules
   SET cron_expression = '*/5 * * * *',
       worker = 'edge:mips-face-sweep',
       is_active = true
 WHERE key = 'mips_face_enrollment_sweep';

INSERT INTO public.automation_rules (key, name, description, category, cron_expression, is_active, is_system, use_ai, worker, worker_payload)
SELECT
  'mips_face_enrollment_sweep',
  'MIPS Face Enrollment Sweep',
  'Compares expected face population against each turnstile''s live photo count and re-pushes missing face photos in bounded batches until the gates match.',
  'system',
  '*/5 * * * *',
  true,
  true,
  false,
  'edge:mips-face-sweep',
  '{"batch": 3}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.automation_rules WHERE key = 'mips_face_enrollment_sweep');