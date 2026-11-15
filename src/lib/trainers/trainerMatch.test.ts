// @ts-expect-error bun:test types not installed
import { describe, expect, test } from 'bun:test';
import { confidenceFor, rankTrainers, shiftOverlap, usualWindow, type MatchTrainerRow } from './trainerMatch';

const shifts = (ms: string, me: string) => [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, off: false, ms, me, es: null, ee: null, st: null, et: null }));
const tr = (id: string, ms: string, me: string, clients = 0, max = 20, weekly_off: string | null = null): MatchTrainerRow =>
  ({ trainer_id: id, name: id, avatar_url: null, max_clients: max, clients, weekly_off, shifts: shifts(ms, me) });
// Member arrives ~07:00 Mon–Sat
const w = usualWindow({ visits: 12, minutes: Array(12).fill(420), dows: [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6] });

describe('trainer match', () => {
  test('in-shift trainer ranks above partial and off-shift', () => {
    const r = rankTrainers(w, [tr('off', '17:00', '22:00'), tr('partial', '07:30', '11:00'), tr('in', '06:00', '11:00')]);
    expect(r.map((x) => x.trainer.trainer_id)).toEqual(['in', 'partial', 'off']);
    expect(r[0].label).toBe('Best match');
    expect(r[2].label).toBe('Not on shift');
  });
  test('weekly off day is not counted as on shift', () => {
    const sun = usualWindow({ visits: 8, minutes: Array(8).fill(420), dows: Array(8).fill(0) });
    const t = { ...tr('t', '06:00', '11:00', 0, 20, 'sunday'), shifts: [{ weekday: 0, off: false, ms: '06:00', me: '11:00', es: null, ee: null, st: null, et: null }] };
    expect(shiftOverlap(sun, t)).toBe(0);
  });
  test('full trainer is marked at capacity and ranked last', () => {
    const r = rankTrainers(w, [tr('full', '06:00', '11:00', 20, 20), tr('free', '06:00', '11:00', 2, 20)]);
    expect(r[0].trainer.trainer_id).toBe('free');
    expect(r[1].label).toBe('At capacity');
  });
  test('under 3 visits means not enough data', () => {
    expect(confidenceFor(2)).toBe('none');
    expect(confidenceFor(3)).toBe('some');
    expect(confidenceFor(8)).toBe('strong');
  });
});
