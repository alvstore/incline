import { describe, expect, it } from 'bun:test';
import { demosVisible, isSignedLinkFresh } from '../../src/lib/exercises/exerciseMedia';

describe('exercise demo visibility', () => {
  it('members cannot see demos while the owner switch is off', () => {
    expect(demosVisible(['member'], false)).toBe(false);
  });
  it('members see demos once the owner switch is on', () => {
    expect(demosVisible(['member'], true)).toBe(true);
  });
  it('trainers always see demos regardless of the switch', () => {
    expect(demosVisible(['trainer'], false)).toBe(true);
  });
});

describe('exercise demo link freshness', () => {
  const issued = 1_000_000;
  it('a link is usable 4 minutes after it was issued', () => {
    expect(isSignedLinkFresh(issued, issued + 4 * 60_000, 300)).toBe(true);
  });
  it('a link is treated as expired 30 seconds before the 5-minute server expiry', () => {
    expect(isSignedLinkFresh(issued, issued + 4 * 60_000 + 31_000, 300)).toBe(false);
  });
  it('a link opened 6 minutes after issue is never reused (Mohit play bug)', () => {
    expect(isSignedLinkFresh(issued, issued + 6 * 60_000, 300)).toBe(false);
  });
});
