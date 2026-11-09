// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { isInsightStale } from './insightsFreshness';

describe('isInsightStale', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  it('is stale when nothing was saved', () => expect(isInsightStale(null, now)).toBe(true));
  it('is fresh under 6 hours', () => expect(isInsightStale('2026-11-10T06:30:00Z', now)).toBe(false));
  it('is stale at 6 hours or more', () => expect(isInsightStale('2026-11-10T06:00:00Z', now)).toBe(true));
});
