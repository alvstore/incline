import { supabase } from '@/integrations/supabase/client';

async function checkAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export interface LeadFilters {
  branchId?: string;
  status?: string[];
  temperature?: string[];
  source?: string;
  ownerId?: string;
  search?: string;
  tags?: string[];
  overdueOnly?: boolean;
}

export interface SavedView {
  id: string;
  name: string;
  filters: LeadFilters;
  is_default: boolean;
}

export const leadService = {
  async fetchLeads(branchId?: string, filters?: LeadFilters) {
    const user = await checkAuth();
    if (!user) return [];

    let query = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    const effectiveBranchId = filters?.branchId || branchId;
    if (effectiveBranchId) query = query.eq('branch_id', effectiveBranchId);
    if (filters?.status?.length) query = query.in('status', filters.status as any);
    if (filters?.temperature?.length) query = query.in('temperature', filters.temperature);
    if (filters?.source && filters.source !== 'all') query = query.eq('source', filters.source);
    if (filters?.ownerId) {
      if (filters.ownerId === 'unassigned') query = query.is('owner_id', null);
      else query = query.eq('owner_id', filters.ownerId);
    }
    if (filters?.search) {
      const s = `%${filters.search}%`;
      query = query.or(`full_name.ilike.${s},phone.ilike.${s},email.ilike.${s}`);
    }
    if (filters?.overdueOnly) {
      query = query.lt('next_action_at', new Date().toISOString());
    }
    query = query.is('merged_into', null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async fetchLeadById(leadId: string) {
    const user = await checkAuth();
    if (!user) return null;
    const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async createLead(lead: any) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('leads').insert(lead).select().single();
    if (error) throw error;
    if (data) {
      await supabase.from('lead_activities').insert({
        lead_id: data.id, branch_id: data.branch_id, actor_id: user.id,
        activity_type: 'created', title: 'Lead created', notes: `Source: ${data.source || 'direct'}`,
      });
    }
    return data;
  },

  async updateLead(leadId: string, updates: any) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('leads').update(updates).eq('id', leadId).select().single();
    if (error) throw error;
    return data;
  },

  async updateLeadStatus(leadId: string, status: string, reason?: string) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const updates: any = { status };
    if (status === 'lost' && reason) updates.lost_reason = reason;
    if (status === 'converted') updates.won_at = new Date().toISOString();
    const { data, error } = await supabase.from('leads').update(updates).eq('id', leadId).select().single();
    if (error) throw error;
    if (data) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId, branch_id: data.branch_id, actor_id: user.id,
        activity_type: 'status_change', title: `Status changed to ${status}`,
        metadata: { to: status, reason },
      });
    }
    return data;
  },

  async assignLead(leadId: string, ownerId: string | null) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('leads').update({ owner_id: ownerId }).eq('id', leadId).select().single();
    if (error) throw error;
    if (data) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId, branch_id: data.branch_id, actor_id: user.id,
        activity_type: 'assignment', title: ownerId ? 'Lead assigned' : 'Lead unassigned',
        metadata: { owner_id: ownerId },
      });
    }
    return data;
  },

  async updateLeadScore(leadId: string, score: number) {
    return this.updateLead(leadId, { score: Math.max(0, Math.min(100, score)) });
  },

  async updateLeadTemperature(leadId: string, temperature: string) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('leads').update({ temperature }).eq('id', leadId).select().single();
    if (error) throw error;
    return data;
  },

  // Bulk operations
  async bulkUpdateLeads(ids: string[], updates: any) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('leads').update(updates).in('id', ids).select();
    if (error) throw error;
    return data;
  },

  // Activities
  async fetchLeadActivities(leadId: string) {
    const user = await checkAuth();
    if (!user) return [];
    const { data, error } = await supabase
      .from('lead_activities').select('*').eq('lead_id', leadId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createActivity(activity: {
    lead_id: string; branch_id: string; activity_type: string;
    title?: string; notes?: string; metadata?: any;
  }) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('lead_activities').insert({ ...activity, actor_id: user.id }).select().single();
    if (error) throw error;
    if (['call', 'whatsapp', 'email', 'visit', 'sms'].includes(activity.activity_type)) {
      const contactUpdate: any = { last_contacted_at: new Date().toISOString() };
      const lead = await this.fetchLeadById(activity.lead_id);
      if (lead && !lead.first_response_at) contactUpdate.first_response_at = new Date().toISOString();
      await supabase.from('leads').update(contactUpdate).eq('id', activity.lead_id);
    }
    return data;
  },

  // Legacy followups support
  async fetchFollowups(leadId: string) {
    const user = await checkAuth();
    if (!user) return [];
    const { data, error } = await supabase.from('lead_followups').select('*').eq('lead_id', leadId).order('followup_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createFollowup(followup: { lead_id: string; followup_date: string; notes?: string; outcome?: string; next_followup_date?: string; }) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('lead_followups').insert(followup).select().single();
    if (error) throw error;
    return data;
  },

  // Duplicate detection
  async detectDuplicates(phone?: string, email?: string, excludeId?: string) {
    if (!phone && !email) return [];
    const user = await checkAuth();
    if (!user) return [];
    let query = supabase.from('leads').select('id, full_name, phone, email, status, branch_id, score, temperature');
    if (phone && email) query = query.or(`phone.eq.${phone},email.eq.${email}`);
    else if (phone) query = query.eq('phone', phone);
    else if (email) query = query.eq('email', email!);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  // Merge leads
  async mergeLeads(primaryId: string, duplicateId: string) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    // Move activities to primary
    await supabase.from('lead_activities').update({ lead_id: primaryId }).eq('lead_id', duplicateId);
    // Mark duplicate
    await supabase.from('leads').update({ merged_into: primaryId, status: 'lost', lost_reason: 'Merged as duplicate' }).eq('id', duplicateId);
    // Log
    const lead = await this.fetchLeadById(primaryId);
    if (lead) {
      await supabase.from('lead_activities').insert({
        lead_id: primaryId, branch_id: lead.branch_id, actor_id: user.id,
        activity_type: 'merge', title: 'Duplicate merged', metadata: { merged_from: duplicateId },
      });
    }
    return true;
  },

  async convertToMember(leadId: string, branchId: string, idempotencyKey?: string) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    // Single backend authority path — RPC handles member creation, lead update,
    // activity log, audit log, and idempotency (retry-safe).
    const idem = idempotencyKey || `lead-convert:${leadId}:${branchId}`;
    const { data, error } = await supabase.rpc('convert_lead_to_member', {
      p_lead_id: leadId,
      p_branch_id: branchId,
      p_idempotency_key: idem,
      p_payload: {},
    });
    if (error) throw new Error(`Lead conversion failed: ${error.message}`);
    const result = data as { success: boolean; member_id?: string; error?: string; idempotent_hit?: boolean };
    if (!result?.success) {
      const code = result?.error || 'unknown_error';
      const friendly: Record<string, string> = {
        not_authenticated: 'Please sign in again to convert this lead.',
        forbidden: "You don't have permission to convert leads.",
        lead_not_found: 'This lead no longer exists.',
        lead_lost: 'This lead is marked as Lost — reopen it before converting.',
        do_not_contact: 'This lead is on Do-Not-Contact and cannot be converted.',
      };
      throw new Error(friendly[code] || `Lead conversion failed: ${code}`);
    }
    // Best-effort: mint an auth user + profile so the new member can log in and
    // downstream systems (MIPS sync, comms) have complete personal data.
    // Non-blocking: conversion still succeeds if provisioning fails.
    if (result.member_id) {
      supabase.functions.invoke('provision-member-login', {
        body: { member_id: result.member_id },
      }).catch((e) => console.warn('provision-member-login failed:', e?.message || e));
    }
    return { memberId: result.member_id, idempotent: !!result.idempotent_hit };
  },

  async getLeadStats(branchId?: string) {
    const user = await checkAuth();
    if (!user) return { total: 0, new: 0, contacted: 0, qualified: 0, negotiation: 0, converted: 0, lost: 0, hot: 0, warm: 0, cold: 0, unassigned: 0, overdue: 0 };
    let query = supabase.from('leads').select('status, temperature, owner_id, next_action_at').is('merged_into', null);
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query;
    if (error) throw error;
    const now = new Date();
    const stats = { total: data?.length || 0, new: 0, contacted: 0, qualified: 0, negotiation: 0, converted: 0, lost: 0, hot: 0, warm: 0, cold: 0, unassigned: 0, overdue: 0 };
    data?.forEach((lead: any) => {
      if (lead.status in stats) (stats as any)[lead.status]++;
      if (lead.temperature in stats) (stats as any)[lead.temperature]++;
      if (!lead.owner_id) stats.unassigned++;
      if (lead.next_action_at && new Date(lead.next_action_at) < now) stats.overdue++;
    });
    return stats;
  },

  // AI Scoring
  async scoreLeads(leadIds: string[]) {
    const { data, error } = await supabase.functions.invoke('score-leads', {
      body: { lead_ids: leadIds },
    });
    if (error) throw new Error(`Scoring failed: ${error.message}`);
    return data;
  },

  // Saved Views
  async getSavedViews() {
    const user = await checkAuth();
    if (!user) return [];
    const { data, error } = await supabase.from('saved_lead_views').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as SavedView[];
  },

  async saveView(name: string, filters: LeadFilters, isDefault = false) {
    const user = await checkAuth();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('saved_lead_views').insert({
      user_id: user.id, name, filters: filters as any, is_default: isDefault,
    }).select().single();
    if (error) throw error;
    return data;
  },

  async deleteView(viewId: string) {
    const { error } = await supabase.from('saved_lead_views').delete().eq('id', viewId);
    if (error) throw error;
  },

  // SMS scheduling (via send-sms edge function)
  async scheduleSMS(phone: string, message: string, time: string, branchId?: string) {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { action: 'schedule', phone, message, time, branch_id: branchId },
    });
    if (error) throw new Error(`SMS scheduling failed: ${error.message}`);
    return data;
  },

  // RoundSMS utilities
  async checkSMSBalance() {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { action: 'balance' },
    });
    if (error) throw new Error(`Balance check failed: ${error.message}`);
    return data;
  },

  async getSenderIds() {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { action: 'senderids' },
    });
    if (error) throw new Error(`Sender IDs failed: ${error.message}`);
    return data;
  },

  async getDeliveryReport(msgid: string, phone: string, msgtype: string) {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { action: 'delivery_report', msgid, phone, msgtype },
    });
    if (error) throw new Error(`DLR failed: ${error.message}`);
    return data;
  },
};
