import { describe, it, expect } from 'bun:test';
import { getEmploymentAgreementTemplate, noticePhrase } from './employmentAgreementTemplate';

const trainer = getEmploymentAgreementTemplate('trainer', 'Test Trainer', 20000, '2026-11-07', {}, 10, 60);

describe('employment agreement template', () => {
  it('trainer contract lists only trainer responsibilities', () => {
    expect(trainer).toContain('FITNESS TRAINER');
    expect(trainer).not.toContain('SALES STAFF');
    expect(trainer).not.toContain('SALES EXECUTIVE');
    expect(trainer).not.toMatch(/###\s*MANAGER/);
  });
  it('uses the entered notice period, not 90 days', () => {
    expect(trainer).toContain('60 (sixty) days');
    expect(trainer).not.toContain('90 (ninety)');
  });
  it('includes the three conduct rules', () => {
    expect(trainer).toMatch(/No private \/ under-the-table PT/);
    expect(trainer).toMatch(/No outside supplements/);
    expect(trainer).toMatch(/No money borrowing or lending/);
  });
  it('spells notice days', () => {
    expect(noticePhrase(45)).toBe('45 (forty-five) days');
  });
});
