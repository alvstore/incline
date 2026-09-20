import { supabase } from '@/integrations/supabase/client';
import type {
  ClassSession,
  ClassSessionEvent,
  ClassSessionRow,
  ClassSessionTypeSummary,
  ClassTemplateInsert,
  ClassTemplateRow,
  ClassTemplateUpdate,
  ClassTypeInsert,
  ClassTypeRow,
  ClassTypeUpdate,
  ClassTypeWithTemplates,
  DeleteTemplateResult,
  GenerateSessionsResult,
  MemberClassBooking,
  NotifyResult,
  OverrideSessionInput,
  SessionActionResult,
} from '@/types/classEngine';

// ─── Parent: class types ────────────────────────────────────────────────────

export async function fetchClassTypes(branchId: string, includeInactive = true): Promise<ClassTypeWithTemplates[]> {
  let query = supabase
    .from('class_types')
    .select('*, templates:class_templates!class_templates_class_type_id_fkey(*)')
    .eq('branch_id', branchId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<ClassTypeRow & { templates: ClassTemplateRow[] | null }>;
  const typeIds = rows.map((r) => r.id);
  const counts: Record<string, number> = {};
  if (typeIds.length) {
    const { data: sessions, error: sErr } = await supabase
      .from('classes')
      .select('class_type_id')
      .eq('branch_id', branchId)
      .in('class_type_id', typeIds)
      .eq('is_active', true)
      .is('cancelled_at', null)
      .gte('scheduled_at', new Date().toISOString());
    if (sErr) throw sErr;
    for (const s of sessions ?? []) {
      if (s.class_type_id) counts[s.class_type_id] = (counts[s.class_type_id] ?? 0) + 1;
    }
  }

  return rows.map((r) => ({
    ...r,
    templates: [...(r.templates ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    upcoming_sessions: counts[r.id] ?? 0,
  }));
}

export async function createClassType(input: ClassTypeInsert): Promise<ClassTypeRow> {
  const { data, error } = await supabase.from('class_types').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateClassType(id: string, updates: ClassTypeUpdate): Promise<ClassTypeRow> {
  const { data, error } = await supabase.from('class_types').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/**
 * Permanently removes a class type. Every rule is retired through
 * `delete_class_template` first so future sessions are cleaned up (and booked
 * members notified) before the parent row goes.
 */
export async function deleteClassType(id: string): Promise<{ notified: number; cancelled_sessions: number }> {
  const { data: templates, error } = await supabase.from('class_templates').select('id').eq('class_type_id', id);
  if (error) throw error;
  let notified = 0;
  let cancelled = 0;
  for (const t of templates ?? []) {
    const res = await deleteClassTemplate(t.id, 'Class discontinued');
    notified += res.notified;
    cancelled += res.result.cancelled_sessions ?? 0;
  }
  const { error: dErr } = await supabase.from('class_types').delete().eq('id', id);
  if (dErr) throw dErr;
  return { notified, cancelled_sessions: cancelled };
}

// ─── Children: schedule rules ───────────────────────────────────────────────

export async function createClassTemplate(input: ClassTemplateInsert): Promise<ClassTemplateRow> {
  const { data, error } = await supabase.from('class_templates').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateClassTemplate(id: string, updates: ClassTemplateUpdate): Promise<ClassTemplateRow> {
  const { data, error } = await supabase.from('class_templates').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteClassTemplate(
  id: string,
  reason?: string,
): Promise<{ result: DeleteTemplateResult; notified: number }> {
  const { data, error } = await supabase.rpc('delete_class_template', { p_template_id: id, p_reason: reason ?? null });
  if (error) throw error;
  const result = data as unknown as DeleteTemplateResult;
  if (!result.success) throw new Error(result.error || 'Could not delete schedule rule');

  let notified = 0;
  for (const classId of result.cancelled_class_ids ?? []) {
    const n = await notifyClassSession(classId, 'session_cancelled', { reason: reason ?? 'Schedule discontinued' });
    notified += n.sent;
  }
  return { result, notified };
}

export async function generateClassSessions(templateId?: string, daysAhead?: number): Promise<GenerateSessionsResult> {
  const { data, error } = await supabase.rpc('generate_class_sessions', {
    p_template_id: templateId ?? null,
    p_days_ahead: daysAhead ?? null,
  });
  if (error) throw error;
  return data as unknown as GenerateSessionsResult;
}

// ─── Sessions ───────────────────────────────────────────────────────────────

async function resolveTrainerNames(trainerIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(trainerIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data: trainers, error } = await supabase.from('trainers_directory').select('id, user_id').in('id', ids);
  if (error) throw error;
  const userIds = (trainers ?? []).map((t) => t.user_id).filter((u): u is string => !!u);
  if (!userIds.length) return {};
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
  if (pErr) throw pErr;
  const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? '']));
  const out: Record<string, string> = {};
  for (const t of trainers ?? []) {
    if (t.id && t.user_id) {
      const name = nameByUser.get(t.user_id);
      if (name) out[t.id] = name;
    }
  }
  return out;
}

type SessionQueryRow = ClassSessionRow & { class_type: ClassSessionTypeSummary | null };

export interface FetchSessionsOptions {
  fromISO: string;
  toISO: string;
  includeCancelled?: boolean;
  classTypeId?: string;
}

export async function fetchClassSessions(branchId: string, opts: FetchSessionsOptions): Promise<ClassSession[]> {
  let query = supabase
    .from('classes')
    .select('*, class_type:class_types!classes_class_type_id_fkey(id, name, image_url, category)')
    .eq('branch_id', branchId)
    .gte('scheduled_at', opts.fromISO)
    .lt('scheduled_at', opts.toISO)
    .order('scheduled_at', { ascending: true });
  if (!opts.includeCancelled) query = query.eq('is_active', true).is('cancelled_at', null);
  if (opts.classTypeId) query = query.eq('class_type_id', opts.classTypeId);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as SessionQueryRow[];
  const names = await resolveTrainerNames(rows.map((r) => r.trainer_id ?? '').filter(Boolean));
  return rows.map((r) => ({ ...r, trainer_name: r.trainer_id ? names[r.trainer_id] ?? null : null }));
}

export async function fetchMemberClassBookings(memberId: string): Promise<MemberClassBooking[]> {
  const { data, error } = await supabase
    .from('class_bookings')
    .select('id, class_id, status')
    .eq('member_id', memberId)
    .eq('status', 'booked');
  if (error) throw error;
  return (data ?? []) as MemberClassBooking[];
}

// ─── Session-level actions (atomic RPCs) ────────────────────────────────────

export async function notifyClassSession(
  classId: string,
  event: ClassSessionEvent,
  extra?: { member_ids?: string[]; changes?: { trainer_changed?: boolean; time_changed?: boolean; venue_changed?: boolean }; reason?: string | null },
): Promise<NotifyResult> {
  const { data, error } = await supabase.functions.invoke('notify-class-session', {
    body: { class_id: classId, event, ...extra },
  });
  if (error) return { success: false, members: 0, sent: 0, error: error.message };
  const res = (data ?? {}) as Partial<NotifyResult>;
  return { success: !!res.success, members: res.members ?? 0, sent: res.sent ?? 0, error: res.error };
}

export async function cancelClassSession(
  classId: string,
  reason?: string,
): Promise<{ result: SessionActionResult; notify: NotifyResult | null }> {
  const { data, error } = await supabase.rpc('cancel_class_session', { p_class_id: classId, p_reason: reason ?? null });
  if (error) throw error;
  const result = data as unknown as SessionActionResult;
  if (!result.success) throw new Error(result.error || 'Could not cancel class');
  let notify: NotifyResult | null = null;
  if (!result.already_cancelled && (result.member_ids?.length ?? 0) > 0) {
    notify = await notifyClassSession(classId, 'session_cancelled', { member_ids: result.member_ids, reason: reason ?? null });
  }
  return { result, notify };
}

export async function reinstateClassSession(classId: string): Promise<SessionActionResult> {
  const { data, error } = await supabase.rpc('reinstate_class_session', { p_class_id: classId });
  if (error) throw error;
  const result = data as unknown as SessionActionResult;
  if (!result.success) throw new Error(result.error || 'Could not reinstate class');
  return result;
}

export async function overrideClassSession(
  input: OverrideSessionInput,
  opts?: { notify?: boolean; venueChanged?: boolean },
): Promise<{ result: SessionActionResult; notify: NotifyResult | null }> {
  const { data, error } = await supabase.rpc('override_class_session', {
    p_class_id: input.classId,
    p_trainer_id: input.trainerId ?? null,
    p_external_trainer_name: input.externalTrainerName ?? null,
    p_capacity: input.capacity ?? null,
    p_start_time: input.startTime ?? null,
    p_duration_minutes: input.durationMinutes ?? null,
    p_venue: input.venue ?? null,
    p_clear_trainer: input.clearTrainer ?? false,
  });
  if (error) throw error;
  const result = data as unknown as SessionActionResult;
  if (!result.success) throw new Error(result.error || 'Could not update class');

  let notify: NotifyResult | null = null;
  const material = !!result.trainer_changed || !!result.time_changed || !!opts?.venueChanged;
  if (opts?.notify !== false && material && (result.member_ids?.length ?? 0) > 0) {
    notify = await notifyClassSession(input.classId, 'session_updated', {
      member_ids: result.member_ids,
      changes: { trainer_changed: !!result.trainer_changed, time_changed: !!result.time_changed, venue_changed: !!opts?.venueChanged },
    });
  }
  return { result, notify };
}
