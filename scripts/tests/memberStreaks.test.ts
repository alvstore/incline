import { describe, expect, test } from 'bun:test';
import { calculateMemberStreaks, loadAttendancePages, streakWindow } from '../../src/lib/attendance/memberStreaks';

describe('attendance return badges', () => {
  test('reads beyond 1000 rows so daily visitors do not get a month-long gap', async () => {
    const rows = Array.from({ length: 1797 }, (_, i) => ({
      member_id: i < 1795 ? 'other' : 'INC-26-0077',
      check_in: i === 1796 ? '2026-11-04T03:30:00Z' : i === 1795 ? '2026-11-03T03:44:35Z' : '2026-10-01T03:00:00Z',
    }));
    const ranges: number[] = [];
    const loaded = await loadAttendancePages(async (from, to) => {
      ranges.push(from);
      return rows.slice(from, to + 1);
    });
    expect(loaded).toHaveLength(1797);
    expect(ranges).toEqual([0, 500, 1000, 1500]);
    expect(calculateMemberStreaks(loaded, ['INC-26-0077'], '2026-11-04')['INC-26-0077'])
      .toEqual({ streak: 2, gapDays: 1, lastVisit: '2026-11-03' });
  });

  test('counts bounce scans as one IST day, independent of browser timezone', () => {
    const rows = ['2026-11-02T18:30:00Z', '2026-11-03T18:29:59Z', '2026-11-03T18:30:00Z']
      .map(check_in => ({ member_id: 'member', check_in }));
    expect(calculateMemberStreaks(rows, ['member'], '2026-11-04').member)
      .toEqual({ streak: 2, gapDays: 1, lastVisit: '2026-11-03' });
    expect(streakWindow('2026-11-04').until).toBe('2026-11-04T18:30:00.000Z');
  });

  test('retains genuine return gaps and rejects partial history on failure', async () => {
    expect(calculateMemberStreaks([
      { member_id: 'member', check_in: '2026-10-30T03:00:00Z' },
      { member_id: 'member', check_in: '2026-11-04T03:00:00Z' },
    ], ['member'], '2026-11-04').member.gapDays).toBe(5);
    await expect(loadAttendancePages(async from => {
      if (from) throw new Error('History unavailable');
      return Array.from({ length: 500 }, () => ({ member_id: 'member', check_in: '2026-11-04T03:00:00Z' }));
    })).rejects.toThrow('History unavailable');
  });
});