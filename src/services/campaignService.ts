import { supabase } from '@/integrations/supabase/client';

export type CampaignChannel = 'whatsapp' | 'email' | 'sms';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'paused';
export type CampaignTriggerType = 'send_now' | 'automated' | 'scheduled';

export type AudienceKind = 'members' | 'leads' | 'lost_leads' | 'contacts' | 'staff' | 'segment' | 'mixed' | 'csv_import';
export type StaffRole = 'owner' | 'admin' | 'manager' | 'staff' | 'trainer';

export interface AudienceFilter {
  audience_kind?: AudienceKind;
  segment_id?: string | null;
  // members
  member_status?: 'active' | 'expired' | 'all';
  goal?: string | null;
  // contacts
  source_types?: Array<'member' | 'lead' | 'manual' | 'ai'>;
  categories?: string[];
  tags?: string[];
  // leads
  lead_status?: string[];
  lead_temperature?: string[];
  // staff
  staff_roles?: StaffRole[];
  // legacy (kept for back-compat with existing saved campaigns)
  status?: 'active' | 'lead' | 'expired' | 'all';
  last_attendance_before?: string | null;
  last_attendance_after?: string | null;
  // csv import (one-shot)
  csv_recipients?: Array<{ name?: string; phone: string; email?: string }>;
}

export interface ResolvedRecipient {
  source_type: 'member' | 'lead' | 'lost_lead' | 'contact' | 'csv';
  source_ref_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  contact_id: string | null;
  in_window?: boolean;
  source_label?: string;
}

export interface AudienceBreakdown {
  total: number;
  in_window: number;
  cold: number;
  by_source: Record<string, number>;
  sample: Array<{ id: string; name: string; phone?: string | null; source?: string }>;
}

export async function resolveCampaignAudience(
  branchId: string,
  filter: AudienceFilter
): Promise<ResolvedRecipient[]> {
  // CSV one-shot bypasses the DB resolver.
  if (filter.audience_kind === 'csv_import') {
    return (filter.csv_recipients || [])
      .filter((r) => !!r.phone)
      .map((r, i) => ({
        source_type: 'csv' as const,
        source_ref_id: null,
        full_name: r.name || null,
        phone: r.phone,
        email: r.email || null,
        contact_id: null,
        in_window: false, // CSV uploads are always treated as cold
        source_label: 'CSV import',
      }));
  }
  const { data, error } = await supabase.rpc('resolve_campaign_audience_v2' as any, {
    p_branch_id: branchId,
    p_filter: filter as any,
    p_window_hours: 24,
  });
  if (error) {
    // Fallback to v1 resolver if v2 not yet deployed (defensive)
    const v1 = await supabase.rpc('resolve_campaign_audience' as any, {
      p_branch_id: branchId,
      p_filter: filter as any,
    });
    if (v1.error) throw v1.error;
    return (v1.data as any) || [];
  }
  return (data as any) || [];
}

/**
 * Aggregate breakdown for the wizard live preview.
 * Returns total / in-window / cold / by-source counts + 5-row sample.
 */
export async function getAudienceBreakdown(
  branchId: string,
  filter: AudienceFilter,
): Promise<AudienceBreakdown> {
  const recipients = await resolveCampaignAudience(branchId, filter);
  const seen = new Set<string>();
  const dedup: ResolvedRecipient[] = [];
  for (const r of recipients) {
    const key = (r.phone || '').replace(/\s+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(r);
  }
  const by_source: Record<string, number> = {};
  let in_window = 0;
  for (const r of dedup) {
    by_source[r.source_type] = (by_source[r.source_type] || 0) + 1;
    if (r.in_window) in_window++;
  }
  return {
    total: dedup.length,
    in_window,
    cold: dedup.length - in_window,
    by_source,
    sample: dedup.slice(0, 5).map((r) => ({
      id: r.source_ref_id || r.phone || '',
      name: r.full_name || 'Unknown',
      phone: r.phone,
      source: r.source_label || r.source_type,
    })),
  };
}

export interface Campaign {
  id: string;
  branch_id: string;
  name: string;
  channel: CampaignChannel;
  audience_filter: AudienceFilter;
  message: string;
  subject: string | null;
  trigger_type: CampaignTriggerType;
  status: CampaignStatus;
  recipients_count: number;
  success_count: number;
  failure_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  template_id?: string | null;
  attachment_url?: string | null;
  attachment_kind?: 'image' | 'document' | 'video' | null;
  attachment_filename?: string | null;
  campaign_type?: 'promotion' | 'event' | 'announcement' | 'lead_reengagement';
  event_meta?: Record<string, any>;
}

/**
 * Resolves the actual member IDs that match the given audience filter.
 * Used both for the live count in the wizard AND for handing the
 * resolved list to send-broadcast on Send Now.
 */
export async function resolveAudienceMemberIds(
  branchId: string,
  filter: AudienceFilter
): Promise<{ memberIds: string[]; sample: Array<{ id: string; name: string }> }> {
  let memberIds: string[] = [];

  // Status filter via memberships
  if (filter.status === 'active') {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('memberships')
      .select('member_id')
      .eq('branch_id', branchId)
      .eq('status', 'active')
      .gte('end_date', today);
    memberIds = [...new Set((data || []).map((m: any) => m.member_id))];
  } else if (filter.status === 'expired') {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('memberships')
      .select('member_id')
      .eq('branch_id', branchId)
      .lt('end_date', today);
    memberIds = [...new Set((data || []).map((m: any) => m.member_id))];
  } else {
    // 'all' or unset: pull every member in branch
    const { data } = await supabase
      .from('members')
      .select('id')
      .eq('branch_id', branchId);
    memberIds = (data || []).map((m: any) => m.id);
  }

  if (memberIds.length === 0) return { memberIds: [], sample: [] };

  // Goal filter
  if (filter.goal) {
    const { data } = await supabase
      .from('members')
      .select('id, fitness_goals')
      .in('id', memberIds);
    memberIds = (data || [])
      .filter((m: any) => (m.fitness_goals || '').toLowerCase().includes(filter.goal!.toLowerCase()))
      .map((m: any) => m.id);
  }

  // Last attendance window
  if (filter.last_attendance_before || filter.last_attendance_after) {
    const { data } = await supabase
      .from('member_attendance')
      .select('member_id, check_in')
      .in('member_id', memberIds)
      .order('check_in', { ascending: false });

    const lastByMember = new Map<string, string>();
    for (const row of data || []) {
      const r: any = row;
      if (!lastByMember.has(r.member_id)) lastByMember.set(r.member_id, r.check_in);
    }

    memberIds = memberIds.filter((id) => {
      const last = lastByMember.get(id);
      if (filter.last_attendance_before && (!last || new Date(last) >= new Date(filter.last_attendance_before))) return false;
      if (filter.last_attendance_after && (!last || new Date(last) <= new Date(filter.last_attendance_after))) return false;
      return true;
    });
  }

  // Sample for preview
  const { data: sampleData } = await supabase
    .from('members')
    .select('id, profiles:user_id(full_name)')
    .in('id', memberIds.slice(0, 5));
  const sample = (sampleData || []).map((m: any) => ({
    id: m.id,
    name: m.profiles?.full_name || 'Unknown',
  }));

  return { memberIds, sample };
}

export async function listCampaigns(branchId: string): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as any) || [];
}

export async function createCampaign(input: Omit<Campaign,
  'id' | 'recipients_count' | 'success_count' | 'failure_count' | 'sent_at' | 'created_at' | 'status'
> & {
  status?: CampaignStatus;
  attachment_url?: string | null;
  attachment_kind?: 'image' | 'document' | 'video' | null;
  attachment_filename?: string | null;
  campaign_type?: 'promotion' | 'event' | 'announcement' | 'lead_reengagement';
  event_meta?: Record<string, any>;
  template_id?: string | null;
}): Promise<Campaign> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      branch_id: input.branch_id,
      name: input.name,
      channel: input.channel,
      audience_filter: input.audience_filter as any,
      message: input.message,
      subject: input.subject,
      trigger_type: input.trigger_type,
      status: input.status || 'draft',
      scheduled_at: input.scheduled_at,
      attachment_url: input.attachment_url ?? null,
      attachment_kind: input.attachment_kind ?? null,
      attachment_filename: input.attachment_filename ?? null,
      campaign_type: input.campaign_type ?? 'announcement',
      event_meta: input.event_meta ?? {},
      template_id: input.template_id ?? null,
      created_by: user?.id,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as any;
}

// ---------- Edit / delete / duplicate / cancel ----------
export async function updateCampaign(
  id: string,
  patch: Partial<Pick<Campaign,
    'name' | 'message' | 'subject' | 'channel' | 'audience_filter' |
    'scheduled_at' | 'attachment_url' | 'attachment_kind' | 'attachment_filename' |
    'campaign_type' | 'event_meta' | 'template_id' | 'trigger_type' | 'status'
  >>,
): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update(patch as any)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as any;
}

export async function deleteCampaign(id: string): Promise<void> {
  // Best-effort clean-up of run rows first (FK may already be ON DELETE CASCADE).
  await supabase.from('campaign_runs' as any).delete().eq('campaign_id', id);
  const { error } = await supabase.from('campaigns').delete().eq('id', id);
  if (error) throw error;
}

export async function cancelScheduledCampaign(id: string): Promise<Campaign> {
  return updateCampaign(id, { status: 'draft' as CampaignStatus, scheduled_at: null, trigger_type: 'send_now' as CampaignTriggerType });
}

export async function duplicateCampaign(id: string): Promise<Campaign> {
  const { data: src, error } = await supabase.from('campaigns').select('*').eq('id', id).single();
  if (error || !src) throw error || new Error('Campaign not found');
  const s: any = src;
  return createCampaign({
    branch_id: s.branch_id,
    name: `${s.name} (copy)`,
    channel: s.channel,
    audience_filter: s.audience_filter,
    message: s.message,
    subject: s.subject,
    trigger_type: 'send_now',
    scheduled_at: null,
    attachment_url: s.attachment_url,
    attachment_kind: s.attachment_kind,
    attachment_filename: s.attachment_filename,
    campaign_type: s.campaign_type,
    event_meta: s.event_meta,
    template_id: s.template_id,
    status: 'draft',
  });
}

export async function sendCampaignNow(
  campaign: Campaign & { attachment_url?: string | null; attachment_kind?: string | null; attachment_filename?: string | null },
  audience: { memberIds?: string[]; recipients?: ResolvedRecipient[] }
): Promise<{ sent: number; failed: number; total: number }> {
  await supabase.from('campaigns').update({ status: 'sending' }).eq('id', campaign.id);

  const { data, error } = await supabase.functions.invoke('send-broadcast', {
    body: {
      channel: campaign.channel,
      message: campaign.message,
      subject: campaign.subject,
      branch_id: campaign.branch_id,
      member_ids: audience.memberIds,
      recipients: audience.recipients,
      campaign_id: campaign.id,
      template_id: (campaign as any).template_id ?? undefined,
      attachment_url: (campaign as any).attachment_url ?? undefined,
      attachment_kind: (campaign as any).attachment_kind ?? undefined,
      attachment_filename: (campaign as any).attachment_filename ?? undefined,
    },
  });
  if (error) throw error;
  return data as any;
}

// ---------- Recurring automation rule ----------
export type RecurrencePreset = 'daily' | 'weekly_mon' | 'weekly_fri' | 'monthly_1st' | 'custom';

const PRESET_TO_CRON: Record<Exclude<RecurrencePreset, 'custom'>, string> = {
  daily:        '0 10 * * *',
  weekly_mon:   '0 10 * * 1',
  weekly_fri:   '0 10 * * 5',
  monthly_1st:  '0 10 1 * *',
};

export function recurrencePresetToCron(preset: RecurrencePreset, custom?: string): string {
  if (preset === 'custom') return custom?.trim() || '0 10 * * *';
  return PRESET_TO_CRON[preset];
}

export async function createRecurringCampaignRule(input: {
  branch_id: string;
  campaign_id: string;
  name: string;
  cron_expression: string;
  ai_tone?: string | null;
}): Promise<{ id: string; key: string }> {
  const key = `campaign_${input.campaign_id.replace(/-/g, '').slice(0, 24)}`;
  const { data, error } = await supabase
    .from('automation_rules' as any)
    .upsert({
      branch_id: input.branch_id,
      key,
      name: `Campaign: ${input.name}`,
      description: 'Auto-created by Campaign Wizard (recurring marketing send)',
      category: 'marketing',
      worker: 'edge:run-campaign',
      worker_payload: { campaign_id: input.campaign_id },
      cron_expression: input.cron_expression,
      is_active: true,
      use_ai: !!input.ai_tone,
      ai_tone: input.ai_tone ?? 'friendly',
      next_run_at: new Date().toISOString(),
    } as any, { onConflict: 'branch_id,key' })
    .select('id, key')
    .single();
  if (error) throw error;
  return data as any;
}

// ---------- Segments ----------
export interface ContactSegment {
  id: string;
  branch_id: string;
  name: string;
  description: string | null;
  filter: AudienceFilter;
  audience_count: number;
  last_refreshed_at: string | null;
  created_at: string;
}

export async function listSegments(branchId: string): Promise<ContactSegment[]> {
  const { data, error } = await supabase
    .from('contact_segments' as any)
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as any) || [];
}

export async function saveSegment(input: {
  branch_id: string; name: string; description?: string; filter: AudienceFilter;
}): Promise<ContactSegment> {
  const { data: { user } } = await supabase.auth.getUser();
  const recipients = await resolveCampaignAudience(input.branch_id, input.filter);
  const { data, error } = await supabase
    .from('contact_segments' as any)
    .insert({
      branch_id: input.branch_id,
      name: input.name,
      description: input.description ?? null,
      filter: input.filter as any,
      audience_count: recipients.length,
      last_refreshed_at: new Date().toISOString(),
      created_by: user?.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as any;
}

export async function deleteSegment(id: string): Promise<void> {
  const { error } = await supabase.from('contact_segments' as any).delete().eq('id', id);
  if (error) throw error;
}

// ---------- Campaign report (per-recipient delivery + grouped failures) ----------
export interface CampaignRecipientRow {
  id: string;
  source_type: string;
  source_label?: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  error_code?: string | null;
  error_reason?: string | null;
  in_window?: boolean | null;
  read_at?: string | null;
  dispatched_at?: string | null;
}

export interface FailureGroup {
  code: string;
  reason: string;
  count: number;
  hint?: string;
}

const FAILURE_HINTS: Record<string, string> = {
  '131047': 'Outside the 24-hour window — only an APPROVED Meta template can reach this recipient.',
  '131026': 'Recipient hasn\'t opted in / unreachable on WhatsApp.',
  'no_template': 'Cold recipient and no approved template was selected for this campaign.',
  'no_phone': 'Recipient has no phone number on file.',
  'opted_out': 'Recipient has opted out of marketing messages.',
};

export async function getCampaignReport(campaignId: string): Promise<{
  recipients: CampaignRecipientRow[];
  groups: FailureGroup[];
}> {
  const { data, error } = await supabase
    .from('campaign_recipients' as any)
    .select('id, source_type, source_label, full_name, phone, email, status, error_code, error_reason, in_window, read_at, dispatched_at')
    .eq('campaign_id', campaignId)
    .order('dispatched_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  const rows = (data as any as CampaignRecipientRow[]) || [];

  const failures = rows.filter((r) => r.status === 'failed');
  const map = new Map<string, FailureGroup>();
  for (const f of failures) {
    const code = f.error_code || 'unknown';
    const reason = f.error_reason || 'Unknown error';
    const k = `${code}::${reason}`;
    const hit = map.get(k);
    if (hit) hit.count++;
    else map.set(k, { code, reason, count: 1, hint: FAILURE_HINTS[code] });
  }
  const groups = Array.from(map.values()).sort((a, b) => b.count - a.count);
  return { recipients: rows, groups };
}

