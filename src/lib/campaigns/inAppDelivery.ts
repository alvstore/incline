// One In-App path: announcement board row + one bell notification per person
// (the web-push worker mirrors each bell row to browser + phone app devices).
import { supabase } from '@/integrations/supabase/client';
import type { AudienceFilter } from '@/services/campaignService';
import type { Json } from '@/integrations/supabase/types';

export interface InAppAttachment { url: string; filename: string; kind: 'image' | 'document' | 'video' }

export async function fetchInAppUserIds(branchId: string, filter: AudienceFilter): Promise<string[]> {
  const { data, error } = await supabase.rpc('inapp_campaign_user_ids', { p_branch_id: branchId, p_filter: filter as Json });
  if (error) throw error;
  return (data || []).map((r: { user_id: string }) => r.user_id);
}

export async function deliverInApp(opts: {
  branchId: string;
  filter: AudienceFilter;
  title: string;
  message: string;
  attachment?: InAppAttachment | null;
  scheduledIso?: string | null;
  requestId: string;
}): Promise<string> {
  const { branchId, filter, title, message, attachment, scheduledIso, requestId } = opts;
  const { data: id, error } = await supabase.rpc('create_inapp_announcement', {
    p_branch_id: branchId, p_filter: filter as Json, p_title: title.trim(), p_message: message.trim(),
    p_publish_at: scheduledIso ?? undefined, p_attachment: attachment ? { ...attachment } : undefined,
    p_request_id: requestId,
  });
  if (error) throw error;
  if (!id) throw new Error('Announcement could not be saved');
  if (scheduledIso) return 'In-App: board post and device alerts scheduled';
  // The durable job remains pending even if this wake-up fails; Automation Brain retries it.
  await supabase.functions.invoke('process-inapp-delivery', { body: { announcement_id: id } });
  return 'In-App: saved and queued for the selected audience';
}
