import { describe, expect, it } from 'bun:test';
import { demosVisible } from '../../src/lib/exercises/exerciseMedia';

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
