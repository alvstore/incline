import { describe, expect, test } from 'bun:test';
import { splitSessionTimeline } from './sessionTimeline';

describe('PT session timeline', () => {
  const now = new Date('2026-10-09T07:30:00Z');
  test('includes earlier walk-in completions on the same IST day', () => {
    const rows = [{ id: 'morning', status: 'completed', scheduled_at: '2026-10-09T00:30:00Z' }];
    expect(splitSessionTimeline(rows, now).today.map(s => s.id)).toEqual(['morning']);
  });
  test('uses IST midnight, not the browser timezone', () => {
    const rows = [
      { id: 'today', status: 'completed', scheduled_at: '2026-10-08T18:30:00Z' },
      { id: 'tomorrow', status: 'scheduled', scheduled_at: '2026-10-09T18:30:00Z' },
    ];
    const result = splitSessionTimeline(rows, now);
    expect(result.today.map(s => s.id)).toEqual(['today']);
    expect(result.upcoming.map(s => s.id)).toEqual(['tomorrow']);
  });
  test('never invents upcoming appointments from completed or cancelled rows', () => {
    const rows = ['scheduled', 'completed', 'cancelled'].map(status => ({
      id: status, status, scheduled_at: '2026-10-10T04:00:00Z',
    }));
    expect(splitSessionTimeline(rows, now).upcoming.map(s => s.id)).toEqual(['scheduled']);
    expect(rows.map(s => s.id)).toEqual(['scheduled', 'completed', 'cancelled']);
  });
});