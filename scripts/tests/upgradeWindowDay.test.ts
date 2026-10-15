import { describe, expect, it } from 'bun:test';
import { upgradeWindowDay, upgradeElapsedPercent } from '../../supabase/functions/_shared/upgradeWindow';

const now = new Date('2026-10-14T04:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe('upgradeWindowDay (15-day window)', () => {
  it('day 1 when 15 days remain', () => expect(upgradeWindowDay(inDays(15), now)).toBe(1));
  it('day 7 when 9 days remain', () => expect(upgradeWindowDay(inDays(9), now)).toBe(7));
  it('day 12 when 4 days remain (72h closing reminder window)', () => expect(upgradeWindowDay(inDays(4), now)).toBe(12));
  it('never exceeds 15 after the window ends', () => expect(upgradeWindowDay(inDays(-2), now)).toBe(15));
  it('elapsed timeline starts empty at the start of the 15-day window', () => expect(upgradeElapsedPercent(inDays(15), now)).toBe(0));
  it('elapsed timeline is half filled with 7.5 days remaining', () => expect(upgradeElapsedPercent(inDays(7.5), now)).toBe(50));
  it('elapsed timeline reaches 100 at the exact 15-day deadline', () => expect(upgradeElapsedPercent(inDays(0), now)).toBe(100));
});
