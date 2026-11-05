// Pure rules for the unified "New message" composer (no I/O — unit tested).
import type { AudienceFilter, CampaignChannel } from '@/services/campaignService';

export type ComposerChannel = 'inapp' | 'whatsapp' | 'sms' | 'email';

export type AudiencePreset = 'active' | 'members_and_staff' | 'all' | 'expired' | 'staff' | 'leads';

export const AUDIENCE_PRESETS: { id: AudiencePreset; label: string; desc: string; inApp: boolean }[] = [
  { id: 'active', label: 'Active members', desc: 'Live or frozen memberships', inApp: true },
  { id: 'members_and_staff', label: 'Members + staff', desc: 'Active members, staff and trainers', inApp: true },
  { id: 'all', label: 'All members', desc: 'Everyone on the branch roster', inApp: true },
  { id: 'expired', label: 'Expired members', desc: 'Win-back messages', inApp: true },
  { id: 'staff', label: 'Staff only', desc: 'Team notices', inApp: true },
  { id: 'leads', label: 'Leads', desc: 'Enquiries (no app account)', inApp: false },
];

/** Which in-app audience key the server resolver expects. */
export function inAppAudienceKey(p: AudiencePreset): string | null {
  if (p === 'leads') return null;
  if (p === 'members_and_staff') return 'members_and_staff_active';
  return p;
}

/** Campaign audience filter for external channels (WhatsApp/SMS/Email). */
export function presetToFilter(p: AudiencePreset): AudienceFilter {
  switch (p) {
    case 'active': return { audience_kind: 'members', member_status: 'active' };
    case 'all': return { audience_kind: 'members', member_status: 'all' };
    case 'expired': return { audience_kind: 'members', member_status: 'expired' };
    case 'members_and_staff': return { audience_kind: 'members_and_staff', member_status: 'active' };
    case 'staff': return { audience_kind: 'staff', staff_roles: ['owner', 'admin', 'manager', 'staff', 'trainer'] };
    case 'leads': return { audience_kind: 'leads' };
  }
}

export interface ChannelReadinessInput {
  channel: ComposerChannel;
  preset: AudiencePreset;
  hasApprovedWaTemplate: boolean;
  waTemplatePending: boolean;
  sendNow: boolean;
}

export type Readiness = { ok: true } | { ok: false; reason: string };

export function channelReadiness(i: ChannelReadinessInput): Readiness {
  if (i.channel === 'inapp') {
    return i.preset === 'leads' ? { ok: false, reason: 'Leads have no app account' } : { ok: true };
  }
  if (i.channel === 'whatsapp') {
    if (i.hasApprovedWaTemplate) return { ok: true };
    if (i.waTemplatePending && !i.sendNow) return { ok: true };
    if (i.waTemplatePending) return { ok: false, reason: 'Template waiting for Meta approval — schedule it instead' };
    return { ok: false, reason: 'Pick an approved WhatsApp template' };
  }
  return { ok: true };
}

export interface ComposerDraft {
  channels: ComposerChannel[];
  title: string;
  message: string;
  subject: string;
  sendNow: boolean;
  scheduledAt: string | null; // ISO
}

/** Returns a list of human errors; empty = ready to send. */
export function validateDraft(d: ComposerDraft, now = Date.now()): string[] {
  const errs: string[] = [];
  if (!d.channels.length) errs.push('Pick at least one channel');
  if (!d.message.trim()) errs.push('Write a message');
  if (d.channels.includes('inapp') && !d.title.trim()) errs.push('Add a title for the app notification');
  if (d.channels.includes('email') && !d.subject.trim()) errs.push('Add an email subject');
  if (!d.sendNow) {
    const ts = d.scheduledAt ? Date.parse(d.scheduledAt) : NaN;
    if (Number.isNaN(ts) || ts <= now) errs.push('Pick a future send time');
  }
  return errs;
}

export const externalChannels = (c: ComposerChannel[]): CampaignChannel[] =>
  c.filter((x): x is Exclude<ComposerChannel, 'inapp'> => x !== 'inapp');
