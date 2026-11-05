// One In-App path: announcement board row + one bell notification per person
// (the web-push worker mirrors each bell row to browser + phone app devices).
import { supabase } from '@/integrations/supabase/client';
import { dispatchCommunication } from '@/services/preferencesService';
import { inAppAudienceKey, type AudiencePreset } from './composer';

export interface InAppAttachment { url: string; filename: string; kind: 'image' | 'document' | 'video' }

export async function fetchInAppUserIds(branchId: string, preset: AudiencePreset): Promise<string[]> {
  const key = inAppAudienceKey(preset);
  if (!key) return [];
  const { data, error } = await supabase.rpc('inapp_audience_user_ids', { p_branch_id: branchId, p_audience: key });
  if (error) throw error;
  return (data || []).map((r: { user_id: string }) => r.user_id);
}

export async function deliverInApp(opts: {
  branchId: string;
  preset: AudiencePreset;
  title: string;
  message: string;
  attachment?: InAppAttachment | null;
  scheduledIso?: string | null;
}): Promise<string> {
  const { branchId, preset, title, message, attachment, scheduledIso } = opts;
  const { data: ann, error } = await supabase.from('announcements').insert({
    title: title.trim(), content: message.trim(), branch_id: branchId,
    target_audience: preset === 'staff' ? 'staff' : preset === 'members_and_staff' ? 'members_and_staff' : 'members',
    is_active: true, publish_at: scheduledIso ?? new Date().toISOString(),
    attachment_url: attachment?.url ?? null, attachment_kind: attachment?.kind ?? null, attachment_filename: attachment?.filename ?? null,
  }).select('id').single();
  if (error) throw error;
  if (scheduledIso) return 'In-App: scheduled on the board';

  const users = await fetchInAppUserIds(branchId, preset);
  let ok = 0;
  for (let i = 0; i < users.length; i += 10) {
    const res = await Promise.allSettled(users.slice(i, i + 10).map((uid) => dispatchCommunication({
      branch_id: branchId, channel: 'in_app', category: 'announcement', recipient: uid, user_id: uid,
      payload: { subject: title.trim(), body: message.trim().slice(0, 500) },
      dedupe_key: `announcement:${ann.id}:${uid}:in_app`,
    })));
    ok += res.filter((r) => r.status === 'fulfilled').length;
  }
  return `In-App: ${ok} people`;
}
