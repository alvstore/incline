import { describe, expect, it } from 'bun:test';
import { selectUpgradePreview } from '../../src/lib/upgradePreview';

describe('compact annual-upgrade preview', () => {
  const now = new Date('2026-10-15T14:06:00Z');
  const offers = [5, 2, 4, 1, 3].map(day => ({ id: String(day), window_ends_at: `2026-10-${15 + day}T00:00:00Z` }));
  it('shows at most three members, nearest deadline first', () => {
    expect(selectUpgradePreview(offers, now).map(o => o.id)).toEqual(['1', '2', '3']);
    expect(offers.map(o => o.id)).toEqual(['5', '2', '4', '1', '3']);
  });
  it('removes exact-deadline and expired offers and fills the preview', () => {
    expect(selectUpgradePreview([{ id: 'expired', window_ends_at: now.toISOString() }, ...offers], now).map(o => o.id)).toEqual(['1', '2', '3']);
  });
  it('returns the available members when fewer than three remain', () => {
    expect(selectUpgradePreview(offers.slice(0, 2), now).map(o => o.id)).toEqual(['2', '5']);
  });
});