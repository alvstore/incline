import { describe, expect, test } from 'bun:test';
import { assignmentLabel, isFlagOff } from '../../src/lib/comms/trainerAssignmentNotify';

describe('trainer assignment notifications', () => {
  test('general assignment is labelled General Fitness Training', () => {
    expect(assignmentLabel('general')).toBe('General Fitness Training');
  });
  test('personal assignment includes package detail', () => {
    expect(assignmentLabel('personal', '26 sessions')).toBe('Personal Training (26 sessions)');
  });
  test('kill switch turns off only on explicit false', () => {
    expect(isFlagOff(false)).toBe(true);
    expect(isFlagOff({ enabled: false })).toBe(true);
    expect(isFlagOff(undefined)).toBe(false);
    expect(isFlagOff({ enabled: true })).toBe(false);
  });
});
