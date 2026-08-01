import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { WorkoutPlanContent, DietPlanContent } from "@/types/fitnessPlan";

export type FitnessPlanContent = WorkoutPlanContent | DietPlanContent;

/**
 * Convert a typed plan-content object to Supabase's recursive `Json` shape.
 * Uses a JSON round-trip so the value is provably JSON-serialisable at runtime
 * — avoids structural-type escape hatches like `as unknown as Json`.
 */
function toJsonContent(content: FitnessPlanContent): Json {
  return JSON.parse(JSON.stringify(content)) as Json;
}

/** Narrow Supabase `Json` plan content back to a typed plan content shape. */
function narrowPlanContent(json: Json): FitnessPlanContent {
  // Plan content is always a JSON object; trust the column shape, but avoid `any`.
  return json as unknown as FitnessPlanContent;
}

export interface FitnessPlanTemplate {
  id: string;
  branch_id: string | null;
  name: string;
  type: 'workout' | 'diet';
  description: string | null;
  difficulty: string | null;
  goal: string | null;
  content: FitnessPlanContent;
  is_public: boolean | null;
  is_active: boolean | null;
  is_common?: boolean | null;
  system_template?: boolean | null;
  // PDF-template support
  source_kind?: string | null;
  pdf_url?: string | null;
  pdf_filename?: string | null;
  pdf_size_bytes?: number | null;
  // Audience targeting (applies when is_common = true)
  target_age_min?: number | null;
  target_age_max?: number | null;
  target_gender?: string | null;
  target_weight_min_kg?: number | null;
  target_weight_max_kg?: number | null;
  target_bmi_min?: number | null;
  target_bmi_max?: number | null;
  target_goal?: string | null;
  target_experience?: string[] | null;
  duration_weeks?: number | null;
  days_per_week?: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Audience-targeting fields editable on common (no-PT) templates. */
export interface CommonPlanTargeting {
  target_age_min?: number | null;
  target_age_max?: number | null;
  target_gender?: 'any' | 'male' | 'female';
  target_weight_min_kg?: number | null;
  target_weight_max_kg?: number | null;
  target_bmi_min?: number | null;
  target_bmi_max?: number | null;
  target_goal?: string | null;
  target_experience?: string[];
  duration_weeks?: number | null;
  days_per_week?: number | null;
}

/** A row returned by `match_common_plans()` — ranked common templates for a member. */
export interface MatchedCommonPlan {
  template_id: string;
  name: string;
  description: string | null;
  goal: string | null;
  difficulty: string | null;
  duration_weeks: number | null;
  days_per_week: number | null;
  target_goal: string | null;
  target_gender: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  match_score: number;
}

/** Calls the SECURITY DEFINER `match_common_plans` RPC. */
export async function fetchMatchedCommonPlans(
  memberId: string,
  type: 'workout' | 'diet',
): Promise<MatchedCommonPlan[]> {
  const { data, error } = await supabase.rpc('match_common_plans', {
    p_member_id: memberId,
    p_type: type,
  });
  if (error) throw error;
  return (data || []) as MatchedCommonPlan[];
}

/** Patch a template's audience-targeting metadata. */
export async function updateTemplateTargeting(
  id: string,
  patch: Partial<CommonPlanTargeting & { is_common: boolean }>,
): Promise<void> {
  const { error } = await supabase
    .from('fitness_plan_templates')
    .update(patch as Record<string, unknown>)
    .eq('id', id);
  if (error) throw error;
}

export interface MemberFitnessPlan {
  id: string;
  member_id: string;
  plan_type: string;
  plan_name: string;
  description: string | null;
  plan_data: Json;
  is_custom: boolean | null;
  is_public: boolean | null;
  valid_from: string | null;
  valid_until: string | null;
  created_by: string | null;
  branch_id: string | null;
  // PDF-template support
  source_kind?: string | null;
  pdf_url?: string | null;
  pdf_filename?: string | null;
  pdf_size_bytes?: number | null;
  created_at: string;
  updated_at: string;
}

// Fetch plan templates
export async function fetchPlanTemplates(branchId?: string, type?: 'workout' | 'diet'): Promise<FitnessPlanTemplate[]> {
  let query = supabase
    .from('fitness_plan_templates')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (branchId) {
    query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);
  }
  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(row => ({
    ...row,
    type: row.type as 'workout' | 'diet',
    content: narrowPlanContent(row.content),
  }));
}

// Create plan template
export async function createPlanTemplate(template: {
  branch_id?: string | null;
  name: string;
  type: 'workout' | 'diet';
  description?: string;
  difficulty?: string;
  goal?: string;
  content?: FitnessPlanContent;
  is_public?: boolean;
  is_common?: boolean;
  // PDF-template support
  source_kind?: 'structured' | 'pdf';
  pdf_url?: string | null;
  pdf_filename?: string | null;
  pdf_size_bytes?: number | null;
  // Audience targeting (only meaningful when is_common = true)
  target_age_min?: number | null;
  target_age_max?: number | null;
  target_gender?: 'any' | 'male' | 'female' | null;
  target_weight_min_kg?: number | null;
  target_weight_max_kg?: number | null;
  target_bmi_min?: number | null;
  target_bmi_max?: number | null;
  target_goal?: string | null;
  target_experience?: string[] | null;
  duration_weeks?: number | null;
  days_per_week?: number | null;
}): Promise<FitnessPlanTemplate> {
  const { data: { user } } = await supabase.auth.getUser();

  const { content, ...rest } = template;
  const { data, error } = await supabase
    .from('fitness_plan_templates')
    .insert({
      ...rest,
      content: toJsonContent(content ?? ({} as FitnessPlanContent)),
      created_by: user?.id,
    })
    .select()
    .single();

  if (error) throw error;
  return {
    ...data,
    type: data.type as 'workout' | 'diet',
    content: narrowPlanContent(data.content),
  };
}

/**
 * Upload a PDF file to the public `attachments` bucket under
 * `fitness-templates/{branchId|global}/{uuid}.pdf` and return the public URL.
 */
export async function uploadTemplatePdf(
  file: File,
  branchId?: string | null,
): Promise<{ url: string; path: string; size: number; filename: string }> {
  if (file.type !== 'application/pdf') throw new Error('Only PDF files are allowed.');
  const MAX = 16 * 1024 * 1024;
  if (file.size > MAX) throw new Error('PDF must be 16 MB or smaller.');
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `fitness-templates/${branchId || 'global'}/${id}.pdf`;
  const { error } = await supabase.storage.from('attachments').upload(path, file, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('attachments').getPublicUrl(path);
  return { url: pub.publicUrl, path, size: file.size, filename: file.name };
}

// Update an existing plan template in place (name, description, content, etc.)
export async function updatePlanTemplate(
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    difficulty: string | null;
    goal: string | null;
    content: FitnessPlanContent;
    is_public: boolean;
  }>,
): Promise<FitnessPlanTemplate> {
  const dbPatch: Record<string, unknown> = { ...patch };
  if (patch.content) dbPatch.content = toJsonContent(patch.content);
  const { data, error } = await supabase
    .from('fitness_plan_templates')
    .update(dbPatch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return {
    ...data,
    type: data.type as 'workout' | 'diet',
    content: narrowPlanContent(data.content),
  };
}

// Soft-delete a template (sets is_active = false). Existing assignments are
// preserved because plan content is snapshotted at assign-time.
export async function softDeletePlanTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('fitness_plan_templates')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

// Returns a map of template_id → number of active member assignments.
export async function getTemplateUsageCounts(
  templateIds: string[],
): Promise<Record<string, number>> {
  if (templateIds.length === 0) return {};
  const { data, error } = await supabase
    .from('member_fitness_plans')
    .select('template_id')
    .in('template_id', templateIds);
  if (error) {
    // template_id column may not yet be migrated in older environments —
    // surface zero counts rather than crashing the templates page.
    console.warn('getTemplateUsageCounts failed:', error.message);
    return {};
  }
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    if (!row.template_id) continue;
    counts[row.template_id] = (counts[row.template_id] || 0) + 1;
  }
  return counts;
}

// Fetch a single plan template by id
export async function getPlanTemplate(id: string): Promise<FitnessPlanTemplate | null> {
  const { data, error } = await supabase
    .from('fitness_plan_templates')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    type: data.type as 'workout' | 'diet',
    content: narrowPlanContent(data.content),
  };
}

// Assign plan to member
export async function assignPlanToMember(params: {
  member_id: string;
  plan_name: string;
  plan_type: 'workout' | 'diet';
  description?: string;
  plan_data: FitnessPlanContent;
  is_custom?: boolean;
  valid_from?: string;
  valid_until?: string;
  branch_id?: string;
}): Promise<MemberFitnessPlan> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('member_fitness_plans')
    .insert({
      member_id: params.member_id,
      plan_name: params.plan_name,
      plan_type: params.plan_type,
      description: params.description,
      plan_data: toJsonContent(params.plan_data),
      is_custom: params.is_custom ?? true,
      is_public: false,
      valid_from: params.valid_from || new Date().toISOString().split('T')[0],
      valid_until: params.valid_until,
      branch_id: params.branch_id,
      created_by: user?.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Fetch member's assigned plans
export async function fetchMemberPlans(memberId: string): Promise<MemberFitnessPlan[]> {
  const { data, error } = await supabase
    .from('member_fitness_plans')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export type NotificationChannel = 'email' | 'whatsapp' | 'in_app';

export interface BulkAssignResult {
  member_id: string;
  member_name: string;
  plan_id?: string;
  success: boolean;
  error?: string;
  channels: Partial<Record<NotificationChannel, { sent: boolean; error?: string }>>;
}

export interface BulkAssignParams {
  member_ids: string[];
  plan_name: string;
  plan_type: 'workout' | 'diet';
  description?: string;
  plan_data: FitnessPlanContent;
  is_custom?: boolean;
  valid_from?: string;
  valid_until?: string;
  branch_id?: string;
  channels?: NotificationChannel[];
  /** Optional back-reference to the originating template — lets trainers
   * see "X members are on Template A" and re-push template updates. */
  template_id?: string | null;
  /** When true, marks the assignment as a "Common Plan" (no PT required). */
  is_common?: boolean;
  /** PDF-template support — when set, the member plan carries a direct PDF instead of structured data. */
  source_kind?: 'structured' | 'pdf';
  pdf_url?: string | null;
  pdf_filename?: string | null;
  pdf_size_bytes?: number | null;
}

export interface MemberContact {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  user_id: string | null;
  branch_id: string | null;
}

/** Contact details for members. Name/phone/email live on `profiles`,
 *  NOT on `members` — never select them from `members` directly. */
export async function loadMemberContacts(memberIds: string[]): Promise<Map<string, MemberContact>> {
  if (memberIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('members')
    .select('id, user_id, branch_id, profiles:user_id(full_name, email, phone)')
    .in('id', memberIds);
  if (error) throw error;
  const map = new Map<string, MemberContact>();
  for (const row of data || []) {
    const p: any = (row as any).profiles;
    map.set((row as any).id, {
      id: (row as any).id,
      user_id: (row as any).user_id,
      full_name: p?.full_name || 'Member',
      email: p?.email || null,
      phone: p?.phone || null,
      branch_id: (row as any).branch_id ?? null,
    });
  }
  return map;
}

async function sendOneNotification(
  channel: NotificationChannel,
  contact: MemberContact,
  params: { plan_name: string; plan_type: 'workout' | 'diet'; branch_id?: string },
): Promise<{ sent: boolean; error?: string }> {
  const subject = `New ${params.plan_type} plan assigned`;
  const body = `Hi ${contact.full_name}, your trainer has assigned a new ${params.plan_type} plan: "${params.plan_name}". Open the gym app to view it.`;
  try {
    if (channel === 'email' || channel === 'whatsapp') {
      const recipient = channel === 'email' ? contact.email : contact.phone;
      if (!recipient) return { sent: false, error: `No ${channel === 'email' ? 'email' : 'phone'} on file` };
      if (!params.branch_id) return { sent: false, error: 'No branch context' };
      const { dispatchCommunication, buildDedupeKey } = await import('@/lib/comms/dispatch');
      const result = await dispatchCommunication({
        branch_id: params.branch_id,
        channel,
        category: 'transactional',
        recipient,
        member_id: contact.id,
        payload: { subject, body, use_branded_template: channel === 'email' },
        dedupe_key: buildDedupeKey(['fitness-plan', params.plan_type, contact.id, channel]),
        force: true,
      });
      if (result.status === 'failed' || result.status === 'suppressed') {
        return { sent: false, error: result.reason || result.status };
      }
      return { sent: true };
    }
    if (channel === 'in_app') {
      if (!contact.user_id) return { sent: false, error: 'Member has no app account' };
      const { error } = await supabase.from('notifications').insert({
        user_id: contact.user_id,
        branch_id: params.branch_id || null,
        title: subject,
        message: body,
        type: 'info',
        category: 'fitness_plan',
        action_url: params.plan_type === 'workout' ? '/my-workout' : '/my-diet',
      });
      if (error) throw error;
      return { sent: true };
    }
    return { sent: false, error: 'Unknown channel' };
  } catch (err: any) {
    return { sent: false, error: err?.message || String(err) };
  }
}

/**
 * Bulk-assign a plan to multiple members and fire notifications on the
 * requested channels. Returns a per-member, per-channel result so the UI can
 * render a confirmation screen.
 */
export async function assignPlanToMembers(params: BulkAssignParams): Promise<BulkAssignResult[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const channels = params.channels ?? [];
  const contacts = await loadMemberContacts(params.member_ids);

  const validFrom = params.valid_from || new Date().toISOString().split('T')[0];
  // Guard against a collapsed validity window (valid_until <= valid_from),
  // which would make the assignment instantly "expired" and invisible in the
  // Member Plans "Active" filter. Default to +4 weeks.
  let validUntil = params.valid_until || null;
  if (!validUntil || validUntil <= validFrom) {
    const d = new Date(validFrom);
    d.setDate(d.getDate() + 28);
    validUntil = d.toISOString().split('T')[0];
  }

  /** Branch resolution: explicit branch → member's own branch. Never null,
   *  otherwise the row disappears from the branch-scoped Member Plans list and
   *  WhatsApp/Email dispatch fails with "No branch context". */
  const branchFor = (member_id: string) =>
    params.branch_id || contacts.get(member_id)?.branch_id || null;

  const rows = params.member_ids.map((member_id) => ({
    member_id,
    plan_name: params.plan_name,
    plan_type: params.plan_type,
    description: params.description,
    plan_data: toJsonContent(params.plan_data),
    is_custom: params.is_custom ?? true,
    is_public: false,
    valid_from: validFrom,
    valid_until: validUntil,
    branch_id: branchFor(member_id),
    created_by: user?.id,
    template_id: params.template_id ?? null,
    is_common: params.is_common ?? false,
    source_kind: params.source_kind ?? 'structured',
    pdf_url: params.pdf_url ?? null,
    pdf_filename: params.pdf_filename ?? null,
    pdf_size_bytes: params.pdf_size_bytes ?? null,
  }));

  const { data: inserted, error } = await supabase
    .from('member_fitness_plans')
    .insert(rows)
    .select('id, member_id');
  if (error) throw error;

  const planIdByMember = new Map<string, string>();
  for (const row of inserted || []) {
    if (row.member_id) planIdByMember.set(row.member_id, row.id);
  }

  const results: BulkAssignResult[] = [];
  for (const member_id of params.member_ids) {
    const contact = contacts.get(member_id);
    const channelResults: BulkAssignResult['channels'] = {};
    for (const ch of channels) {
      channelResults[ch] = contact
        ? await sendOneNotification(ch, contact, {
            plan_name: params.plan_name,
            plan_type: params.plan_type,
            branch_id: branchFor(member_id) || undefined,
          })
        : { sent: false, error: 'Member contact not found' };
    }
    results.push({
      member_id,
      member_name: contact?.full_name || 'Unknown',
      plan_id: planIdByMember.get(member_id),
      success: planIdByMember.has(member_id),
      channels: channelResults,
    });
  }
  return results;
}

// Search members for plan assignment.
// NOTE: We intentionally do NOT filter by member_status here — frozen / expired
// members are still valid plan recipients (e.g. trainers prep new plans before
// renewal). The UI dims non-active rows via the returned `member_status` badge.
export async function searchMembersForAssignment(searchTerm: string, branchId?: string | null): Promise<{
  id: string;
  member_code: string;
  full_name: string;
  member_status?: string | null;
}[]> {
  if (!searchTerm || searchTerm.trim().length < 1) return [];
  const { data, error } = await supabase.rpc('search_members', {
    search_term: searchTerm,
    p_branch_id: branchId || null,
    p_limit: 25,
  });

  if (error) {
    console.error('Search error:', error);
    return [];
  }

  return (data || []).map((m: any) => ({
    id: m.id,
    member_code: m.member_code,
    full_name: m.full_name,
    member_status: m.member_status ?? null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Hub helpers — Member assignments listing & lifecycle
// ──────────────────────────────────────────────────────────────────────────

export interface MemberAssignmentRow {
  id: string;
  member_id: string;
  member_name: string;
  member_code: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  plan_name: string;
  plan_type: 'workout' | 'diet';
  description: string | null;
  plan_data: any;
  trainer_name: string | null;
  template_id: string | null;
  template_name: string | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  branch_id: string | null;
  is_expired: boolean;
}

const ASSIGNMENT_COLUMNS =
  'id, member_id, plan_name, plan_type, description, plan_data, valid_from, valid_until, created_at, created_by, template_id, branch_id';

/** Enrich raw member_fitness_plans rows with member / trainer / template names. */
async function mapAssignmentRows(rows: any[]): Promise<MemberAssignmentRow[]> {
  if (!rows?.length) return [];

  const memberIds = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean)));
  const trainerIds = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean) as string[]));
  const templateIds = Array.from(new Set(rows.map((r: any) => r.template_id).filter(Boolean) as string[]));

  const [membersRes, trainersRes, templatesRes] = await Promise.all([
    memberIds.length
      ? supabase.from('members').select('id, member_code, user_id, profiles:user_id(full_name, avatar_url, phone, email)').in('id', memberIds)
      : Promise.resolve({ data: [], error: null } as any),
    trainerIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', trainerIds)
      : Promise.resolve({ data: [], error: null } as any),
    templateIds.length
      ? supabase.from('fitness_plan_templates').select('id, name').in('id', templateIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const memberMap = new Map<string, any>();
  for (const m of membersRes.data || []) memberMap.set((m as any).id, m);
  const trainerMap = new Map<string, string>();
  for (const t of trainersRes.data || []) trainerMap.set((t as any).id, (t as any).full_name);
  const templateMap = new Map<string, string>();
  for (const t of templatesRes.data || []) templateMap.set((t as any).id, (t as any).name);

  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r: any) => {
    const member: any = memberMap.get(r.member_id);
    const profile: any = member?.profiles;
    return {
      id: r.id,
      member_id: r.member_id,
      member_name: profile?.full_name || 'Unknown member',
      member_code: member?.member_code ?? null,
      avatar_url: profile?.avatar_url ?? null,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      plan_name: r.plan_name,
      plan_type: r.plan_type as 'workout' | 'diet',
      description: r.description ?? null,
      plan_data: r.plan_data,
      trainer_name: r.created_by ? trainerMap.get(r.created_by) ?? null : null,
      template_id: r.template_id ?? null,
      template_name: r.template_id ? templateMap.get(r.template_id) ?? null : null,
      valid_from: r.valid_from,
      valid_until: r.valid_until,
      created_at: r.created_at,
      branch_id: r.branch_id ?? null,
      is_expired: !!(r.valid_until && r.valid_until < today),
    };
  });
}

/**
 * Fetch all member plan assignments scoped to the active branch.
 * Joins members → profiles for display, and lazily resolves trainer + template names.
 */
export async function fetchMemberAssignments(
  branchId?: string | null,
): Promise<MemberAssignmentRow[]> {
  let query = supabase
    .from('member_fitness_plans')
    .select(ASSIGNMENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500);
  if (branchId) query = query.eq('branch_id', branchId);

  const { data: rows, error } = await query;
  if (error) throw error;
  return mapAssignmentRows(rows || []);
}

/**
 * Every member this template has been assigned to — intentionally NOT branch
 * filtered so historical/null-branch assignments stay visible from the
 * template card's usage chip.
 */
export async function fetchAssignmentsForTemplate(
  templateId: string,
): Promise<MemberAssignmentRow[]> {
  const { data: rows, error } = await supabase
    .from('member_fitness_plans')
    .select(ASSIGNMENT_COLUMNS)
    .eq('template_id', templateId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return mapAssignmentRows(rows || []);
}


/** Soft-revoke an assignment by setting valid_until = today. */
export async function revokeMemberAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase
    .from('member_fitness_plans')
    .update({ valid_until: new Date().toISOString().slice(0, 10) })
    .eq('id', assignmentId);
  if (error) throw error;
}
