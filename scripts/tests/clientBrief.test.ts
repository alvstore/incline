import { describe, expect, it } from 'vitest';
import { goalList, healthFlags } from '../../src/lib/trainers/clientBrief';

describe('trainer client brief', () => {
  it('splits registration goals into chips', () => {
    expect(goalList('Weight Loss, Flexibility')).toEqual(['Weight Loss', 'Flexibility']);
    expect(goalList(null)).toEqual([]);
  });
  it('does not flag "None / no known conditions"', () => {
    expect(healthFlags('None / no known conditions')).toEqual([]);
  });
  it('flags real conditions', () => {
    expect(healthFlags('Diabetes, Other: knee pain')).toEqual(['Diabetes', 'Other: knee pain']);
  });
});
