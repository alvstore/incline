import { describe, expect, test } from 'bun:test';
import { canReuseGatePush, isGateRepair } from '../../supabase/functions/sync-to-mips/dispatchPolicy';

const prior = { sig: 'joined|2026-11-17|photo-a', at: '2026-10-17T05:00:00Z' };
describe('event-driven gate updates', () => {
  test('a new photo reaches a previously synced gate', () => {
    expect(canReuseGatePush('joined|2026-11-17|photo-b', prior, null, false)).toBe(false);
  });
  test('membership activation reaches a gate previously sent blocked dates', () => {
    expect(canReuseGatePush(prior.sig, { ...prior, sig: 'blocked|2099-12-31|photo-a' }, null, false)).toBe(false);
  });
  test('unchanged state stays quiet without expiring with age', () => {
    expect(canReuseGatePush(prior.sig, prior, null, false)).toBe(true);
  });
  test('explicit repair reissues identical state', () => {
    expect(canReuseGatePush(prior.sig, prior, null, isGateRepair(false, { manual_repush: true }))).toBe(false);
    expect(isGateRepair(true, null)).toBe(true);
    expect(isGateRepair(false, { manual_repush: 'true' })).toBe(false);
  });
  test('full roster refresh invalidates older delivery', () => {
    expect(canReuseGatePush(prior.sig, prior, '2026-10-21T05:00:00Z', false)).toBe(false);
  });
  test('unknown previous state never suppresses an update', () => {
    expect(canReuseGatePush(prior.sig, undefined, null, false)).toBe(false);
    expect(canReuseGatePush(undefined, { sig: null, at: prior.at }, null, false)).toBe(false);
  });
});