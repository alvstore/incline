import { describe, expect, it } from 'bun:test';
import { normalizeWorkoutPlan } from '@/components/member/workout/planNormalize';

describe('normalizeWorkoutPlan video carry-through', () => {
  it('keeps video_url, video_file_path and form_tips on exercises', () => {
    const plan = normalizeWorkoutPlan({
      days: [
        {
          day: 'Monday',
          exercises: [
            {
              name: 'Bench Press',
              sets: 4,
              reps: '8-10',
              video_url: 'https://cdn.example.com/bench.mp4',
              video_file_path: 'exercises/bench.mp4',
              form_tips: ['Retract shoulder blades', 'Feet flat'],
            },
          ],
        },
      ],
    });

    const ex = plan?.days[0]?.exercises[0];
    expect(ex?.video_url).toBe('https://cdn.example.com/bench.mp4');
    expect(ex?.video_file_path).toBe('exercises/bench.mp4');
    expect(ex?.form_tips).toEqual(['Retract shoulder blades', 'Feet flat']);
  });

  it('accepts string form_tips and leaves missing video fields undefined', () => {
    const plan = normalizeWorkoutPlan({
      weeks: [
        {
          week: 1,
          days: [
            {
              day: 'Tuesday',
              exercises: [{ name: 'Squat', sets: 3, reps: '12', form_tips: 'Brace your core' }],
            },
          ],
        },
      ],
    });

    const ex = plan?.days[0]?.exercises[0];
    expect(ex?.form_tips).toEqual(['Brace your core']);
    expect(ex?.video_url).toBeUndefined();
    expect(ex?.video_file_path).toBeUndefined();
  });

  it('still normalises plans without any media fields (legacy JSON)', () => {
    const plan = normalizeWorkoutPlan({
      days: [{ day: 'Friday', exercises: [{ name: 'Row', sets: 3, reps: '10' }] }],
    });
    expect(plan?.days[0]?.exercises[0]?.name).toBe('Row');
  });
});

describe('normalizeWorkoutPlan media preview + machine name', () => {
  it('keeps the WebP poster and the gym machine name exactly as written', () => {
    const plan = normalizeWorkoutPlan({
      days: [{ day: 'Monday', exercises: [{
        name: 'Lat Pulldown', sets: 3, reps: '10',
        equipment: 'SUPER LAT PULLDOWN CIRCULAR',
        video_url: 'https://cdn.example.com/lat.mp4',
        poster_url: 'https://cdn.example.com/lat.webp',
      }] }],
    });
    const ex = plan?.days[0]?.exercises[0];
    expect(ex?.poster_url).toBe('https://cdn.example.com/lat.webp');
    expect(ex?.equipment).toBe('SUPER LAT PULLDOWN CIRCULAR');
  });
});
