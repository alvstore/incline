import { describe, expect, it } from 'vitest';
import { healthFlags } from '../../src/lib/trainers/clientBrief';

describe('trainer health note badge rule', () => {
  it('no badge for blank or "None"', () => {
    expect(healthFlags('')).toEqual([]);
    expect(healthFlags('None')).toEqual([]);
  });
  it('badge for knee injury + hypertension', () => {
    expect(healthFlags('Knee / Joint injury, Hypertension / High BP')).toHaveLength(2);
  });
});
