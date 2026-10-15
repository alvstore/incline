import { describe, expect, it } from 'bun:test';
import { upgradeReminderStage, upgradeReminderHandled, upgradeTimeLeft } from '../../supabase/functions/_shared/upgradeWindow';

const start = '2026-10-01';
const deadline = '2026-10-15T18:30:00Z';
const stage = (now: string, status = 'pending', membership = 'active') => upgradeReminderStage(start, deadline, membership, status, new Date(now));
describe('annual upgrade reminders', () => {
  it('does not send on joining day', () => expect(stage('2026-10-01T03:30:00Z')).toBeNull());
  it('sends Day 7 on October 7, not October 8', () => expect(stage('2026-10-07T03:30:00Z')).toBe('d7'));
  it('catches up a missed Day 7 run before Day 12', () => expect(stage('2026-10-10T03:30:00Z')).toBe('d7'));
  it('sends only closing on Day 12 even if Day 7 never sent', () => expect(stage('2026-10-12T03:30:00Z')).toBe('d12'));
  it('uses IST midnight for Day 12', () => expect(stage('2026-10-11T18:30:00Z')).toBe('d12'));
  it('retains eligibility immediately before deadline', () => expect(stage('2026-10-15T18:29:59Z')).toBe('d12'));
  it('never sends exactly at deadline', () => expect(stage(deadline)).toBeNull());
  it('never sends after expiry', () => expect(stage('2026-10-16T03:30:00Z')).toBeNull());
  it('never sends after conversion', () => expect(stage('2026-10-12T03:30:00Z', 'converted')).toBeNull());
  it('never sends cancelled memberships', () => expect(stage('2026-10-12T03:30:00Z', 'pending', 'cancelled')).toBeNull());
  it('does not re-send queued messages', () => expect(upgradeReminderHandled('queued')).toBe(true));
  it('does not re-send suppressed messages', () => expect(upgradeReminderHandled('suppressed')).toBe(true));
  it('permits a failed attempt to retry', () => expect(upgradeReminderHandled('failed')).toBe(false));
  it('does not repeatedly retry Meta ecosystem rejection 131049', () => expect(upgradeReminderHandled('failed', '131049: ecosystem engagement')).toBe(true));
  it('deduplicates sent messages', () => expect(upgradeReminderHandled('sent')).toBe(true));
  it('expires the visible countdown exactly at deadline', () => expect(upgradeTimeLeft(deadline, new Date(deadline)).expired).toBe(true));
  it('counts one hour remaining accurately', () => expect(upgradeTimeLeft(deadline, new Date('2026-10-15T17:30:00Z')).hours).toBe(1));
});