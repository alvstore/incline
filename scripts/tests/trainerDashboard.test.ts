import { describe, expect, test } from 'bun:test';
import { gateLabel, groupClassesByDay } from '../../src/lib/trainers/dashboard';

describe('trainer dashboard', () => {
  test('device serial is never shown as the gate name', () => {
    expect(gateLabel('F06D92740D0062CF')).toBe('the gate');
    expect(gateLabel(null)).toBe('the gate');
    expect(gateLabel('Main entrance')).toBe('Main entrance');
  });

  test('classes are grouped by IST day, starting today', () => {
    const now = new Date('2026-10-20T19:00:00Z'); // 21 Oct 00:30 IST
    const days = groupClassesByDay([
      { scheduled_at: '2026-10-21T02:30:00Z' }, // 21 Oct 08:00 IST
      { scheduled_at: '2026-10-21T11:30:00Z' }, // 21 Oct 17:00 IST
      { scheduled_at: '2026-10-24T02:30:00Z' }, // 24 Oct
    ], now);
    expect(days[0].key).toBe('2026-10-21');
    expect(days[0].items.length).toBe(2);
    expect(days.find((d) => d.key === '2026-10-24')?.items.length).toBe(1);
  });
});
