// Run: bun test src/lib/campaigns/composer.test.ts
// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { channelReadiness, validateDraft, inAppAudienceKey, presetToFilter, externalChannels, filterToInAppPreset, inAppAudienceFilter } from './composer';

const base = { channels: ['inapp'] as const, title: 'T', message: 'M', subject: '', sendNow: true, scheduledAt: null };

describe('composer rules', () => {
  it('in-app cannot target leads', () => {
    expect(channelReadiness({ channel: 'inapp', preset: 'leads', hasApprovedWaTemplate: false, waTemplatePending: false, sendNow: true }).ok).toBe(false);
    expect(inAppAudienceKey('leads')).toBeNull();
  });
  it('members + staff in-app uses active members plus team', () => {
    expect(inAppAudienceKey('members_and_staff')).toBe('members_and_staff_active');
    expect(presetToFilter('members_and_staff').audience_kind).toBe('members_and_staff');
  });
  it('WhatsApp needs an approved template to send now', () => {
    expect(channelReadiness({ channel: 'whatsapp', preset: 'active', hasApprovedWaTemplate: false, waTemplatePending: true, sendNow: true }).ok).toBe(false);
    expect(channelReadiness({ channel: 'whatsapp', preset: 'active', hasApprovedWaTemplate: false, waTemplatePending: true, sendNow: false }).ok).toBe(true);
    expect(channelReadiness({ channel: 'whatsapp', preset: 'active', hasApprovedWaTemplate: true, waTemplatePending: false, sendNow: true }).ok).toBe(true);
  });
  it('in-app requires a title; email requires a subject', () => {
    expect(validateDraft({ ...base, channels: ['inapp'], title: '' })).toContain('Add a title for the app notification');
    expect(validateDraft({ ...base, channels: ['email'] })).toContain('Add an email subject');
  });
  it('schedule must be in the future', () => {
    expect(validateDraft({ ...base, channels: ['inapp'], sendNow: false, scheduledAt: new Date(1000).toISOString() }, 5000)).toContain('Pick a future send time');
    expect(validateDraft({ ...base, channels: ['inapp'], sendNow: false, scheduledAt: new Date(9000).toISOString() }, 5000)).toEqual([]);
  });
  it('in-app is never sent as an external campaign', () => {
    expect(externalChannels(['inapp', 'whatsapp', 'email'])).toEqual(['whatsapp', 'email']);
  });
});

describe('campaign drawer → In-App audience', () => {
  for (const member_status of ['pending_dues', 'frozen', 'recent_expired', 'inactive_30', 'inactive_60'] as const) {
    it(`preserves ${member_status} rather than selecting active members`, () => {
      expect(inAppAudienceFilter({ audience_kind: 'members', member_status })).toEqual({ audience_kind: 'members', member_status });
    });
  }
  it('preserves staff role selections', () => {
    expect(inAppAudienceFilter({ audience_kind: 'staff', staff_roles: ['trainer'] })?.staff_roles).toEqual(['trainer']);
  });
  it('preserves goals and attendance windows for combined audiences', () => {
    const filter = { audience_kind: 'members_and_staff' as const, goal: 'strength', last_attendance_before: '2026-11-01T00:00:00Z', staff_roles: ['manager' as const] };
    expect(inAppAudienceFilter(filter)).toEqual(filter);
  });
  it('rejects unsupported audiences instead of broadening them', () => {
    expect(inAppAudienceFilter({ audience_kind: 'leads' })).toBeNull();
    expect(inAppAudienceFilter({ audience_kind: 'segment', segment_id: 'saved' })).toBeNull();
  });
  it('leads, contacts and CSV imports have no app audience', () => {
    expect(filterToInAppPreset({ audience_kind: 'leads' } as never)).toBeNull();
    expect(filterToInAppPreset({ audience_kind: 'csv_import' } as never)).toBeNull();
  });
  it('members, staff and mixed audiences map to the matching app audience', () => {
    expect(filterToInAppPreset({ status: 'active' } as never)).toBe('active');
    expect(filterToInAppPreset({ audience_kind: 'members', member_status: 'expired' } as never)).toBe('expired');
    expect(filterToInAppPreset({ audience_kind: 'staff' } as never)).toBe('staff');
    expect(filterToInAppPreset({ audience_kind: 'members_and_staff' } as never)).toBe('members_and_staff');
  });
});
