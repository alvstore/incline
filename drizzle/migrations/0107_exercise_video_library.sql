CREATE TABLE public.exercise_video_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  source TEXT NOT NULL DEFAULT 'curated',
  external_id TEXT,
  form_cues JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name)
);

CREATE INDEX idx_exercise_video_library_name ON public.exercise_video_library (normalized_name text_pattern_ops);

GRANT SELECT ON public.exercise_video_library TO authenticated;
GRANT ALL ON public.exercise_video_library TO service_role;

ALTER TABLE public.exercise_video_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read active exercise videos"
  ON public.exercise_video_library FOR SELECT
  TO authenticated
  USING (active = true);

CREATE POLICY "Staff can manage exercise video library"
  ON public.exercise_video_library FOR ALL
  TO authenticated
  USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])))
  WITH CHECK ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])));

INSERT INTO public.exercise_video_library (name, normalized_name, muscle_group, equipment, form_cues) VALUES
  ('Barbell Back Squat', 'barbell back squat', 'Legs', 'Barbell', '["Brace your core before unracking","Keep knees tracking over toes","Drive through mid-foot"]'),
  ('Barbell Bench Press', 'barbell bench press', 'Chest', 'Barbell', '["Retract shoulder blades","Feet flat on the floor","Touch bar to mid-chest"]'),
  ('Deadlift', 'deadlift', 'Back / Hamstrings', 'Barbell', '["Hinge at the hips, not the lower back","Keep the bar close to shins","Lock out with glutes"]'),
  ('Overhead Press', 'overhead press', 'Shoulders', 'Barbell', '["Squeeze glutes to protect lower back","Press in a straight line","Full lockout overhead"]'),
  ('Bent-Over Row', 'bent over row', 'Back', 'Barbell', '["Flat back throughout","Pull to lower ribs","Control the negative"]'),
  ('Lat Pulldown', 'lat pulldown', 'Back', 'Cable machine', '["Lean back slightly","Pull to upper chest","Avoid swinging"]'),
  ('Seated Cable Row', 'seated cable row', 'Back', 'Cable machine', '["Chest tall","Squeeze shoulder blades at the end","No torso rocking"]'),
  ('Pull-Up', 'pull up', 'Back', 'Bodyweight / Pull-up bar', '["Full dead hang start","Chin over bar","Control the descent"]'),
  ('Dumbbell Shoulder Press', 'dumbbell shoulder press', 'Shoulders', 'Dumbbells', '["Neutral spine","Press up and slightly in","Do not flare elbows excessively"]'),
  ('Lateral Raise', 'lateral raise', 'Shoulders', 'Dumbbells', '["Slight elbow bend","Raise to shoulder height only","No momentum"]'),
  ('Bicep Curl', 'bicep curl', 'Arms', 'Dumbbells', '["Elbows pinned to sides","Full range of motion","Control the negative"]'),
  ('Tricep Pushdown', 'tricep pushdown', 'Arms', 'Cable machine', '["Elbows locked at sides","Full extension","No shoulder involvement"]'),
  ('Leg Press', 'leg press', 'Legs', 'Machine', '["Do not lock knees at top","Lower until 90 degrees","Feet shoulder-width"]'),
  ('Romanian Deadlift', 'romanian deadlift', 'Hamstrings', 'Barbell / Dumbbells', '["Soft knees","Hinge until hamstring stretch","Flat back"]'),
  ('Walking Lunge', 'walking lunge', 'Legs', 'Bodyweight / Dumbbells', '["Long stride","Torso upright","Knee over ankle"]'),
  ('Leg Curl', 'leg curl', 'Hamstrings', 'Machine', '["Hips stay on pad","Full curl","Slow return"]'),
  ('Leg Extension', 'leg extension', 'Quadriceps', 'Machine', '["Controlled tempo","Squeeze at top","Do not slam down"]'),
  ('Hip Thrust', 'hip thrust', 'Glutes', 'Barbell / Bench', '["Chin tucked","Full hip extension","Squeeze glutes at top"]'),
  ('Calf Raise', 'calf raise', 'Calves', 'Machine / Bodyweight', '["Full stretch at bottom","Pause at top","Straight knees"]'),
  ('Chest Fly (Pec Deck)', 'chest fly pec deck', 'Chest', 'Machine', '["Slight elbow bend","Squeeze at center","Control return"]'),
  ('Incline Dumbbell Press', 'incline dumbbell press', 'Upper Chest', 'Dumbbells', '["Bench at 30-45 degrees","Press up and together","Control the negative"]'),
  ('Push-Up', 'push up', 'Chest', 'Bodyweight', '["Straight line head to heels","Chest to floor","Full lockout"]'),
  ('Plank', 'plank', 'Core', 'Bodyweight', '["Neutral spine","Squeeze glutes and abs","Breathe steadily"]'),
  ('Crunch', 'crunch', 'Core', 'Bodyweight', '["Curl ribs to pelvis","Do not pull neck","Exhale on the way up"]'),
  ('Hanging Leg Raise', 'hanging leg raise', 'Core', 'Pull-up bar', '["No swinging","Raise legs to 90 degrees","Control descent"]'),
  ('Kettlebell Swing', 'kettlebell swing', 'Full body', 'Kettlebell', '["Power from hips, not arms","Flat back","Snap hips at top"]'),
  ('Goblet Squat', 'goblet squat', 'Legs', 'Kettlebell / Dumbbell', '["Elbows inside knees","Chest tall","Full depth"]'),
  ('Face Pull', 'face pull', 'Rear Delts / Upper Back', 'Cable machine', '["Pull to forehead","Externally rotate at end","Light weight, high control"]'),
  ('Dips', 'dips', 'Chest / Triceps', 'Dip station', '["Lean forward for chest","Full depth without shoulder pain","Lock out"]'),
  ('Treadmill Incline Walk', 'treadmill incline walk', 'Cardio', 'Treadmill', '["Do not hold rails","Brisk pace","Incline 8-12%"]');

INSERT INTO public.settings (branch_id, key, value, description)
VALUES (NULL, 'exercise_video_library_enabled', 'true'::jsonb, 'Feature flag: exercise video library in workout plan builder and member dashboard')
ON CONFLICT (branch_id, key) DO NOTHING;