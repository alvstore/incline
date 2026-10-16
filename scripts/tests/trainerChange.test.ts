import { describe, it, expect } from 'bun:test';
import { validateTrainerChange, isEscalationReason } from '../../src/components/member/requests/requestTypes';

describe('trainer change request rules', () => {
  it('requires a reason when member has a trainer and flag is on', () => {
    expect(validateTrainerChange({ flagOn: true, hasTrainer: true, reason: null, details: '' })).not.toBeNull();
  });
  it('"Other" requires details', () => {
    expect(validateTrainerChange({ flagOn: true, hasTrainer: true, reason: 'other', details: 'short' })).not.toBeNull();
    expect(validateTrainerChange({ flagOn: true, hasTrainer: true, reason: 'other', details: 'Trainer keeps cancelling' })).toBeNull();
  });
  it('schedule reason needs no details', () => {
    expect(validateTrainerChange({ flagOn: true, hasTrainer: true, reason: 'schedule', details: '' })).toBeNull();
  });
  it('no-trainer request needs no reason', () => {
    expect(validateTrainerChange({ flagOn: true, hasTrainer: false, reason: null, details: '' })).toBeNull();
  });
  it('flag off falls back to free-text note', () => {
    expect(validateTrainerChange({ flagOn: false, hasTrainer: true, reason: null, details: '' })).not.toBeNull();
    expect(validateTrainerChange({ flagOn: false, hasTrainer: true, reason: null, details: 'x' })).toBeNull();
  });
  it('guidance and communication escalate; schedule does not', () => {
    expect(isEscalationReason('guidance')).toBe(true);
    expect(isEscalationReason('communication')).toBe(true);
    expect(isEscalationReason('schedule')).toBe(false);
  });
});
