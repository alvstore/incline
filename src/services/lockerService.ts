import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Locker = Database['public']['Tables']['lockers']['Row'];
type LockerAssignment = Database['public']['Tables']['locker_assignments']['Row'];
type LockerStatus = Database['public']['Enums']['locker_status'];

export interface LockerWithAssignment extends Locker {
  locker_assignments?: (LockerAssignment & {
    members?: {
      member_code: string;
      user_id: string | null;
    } | null;
  })[];
}

export const lockerService = {
  // Get all lockers for a branch
  async getLockers(branchId: string): Promise<LockerWithAssignment[]> {
    const { data, error } = await supabase
      .from('lockers')
      .select(`
        *,
        locker_assignments (
          *,
          members (
            member_code,
            user_id
          )
        )
      `)
      .eq('branch_id', branchId)
      .order('locker_number');

    if (error) throw error;
    return data as LockerWithAssignment[];
  },

  // Get available lockers
  async getAvailableLockers(branchId: string) {
    const { data, error } = await supabase
      .from('lockers')
      .select('*')
      .eq('branch_id', branchId)
      .eq('status', 'available')
      .order('locker_number');

    if (error) throw error;
    return data;
  },

  // Create a locker
  async createLocker(locker: {
    branch_id: string;
    locker_number: string;
    size?: string;
    monthly_fee?: number;
    notes?: string | null;
    location?: string | null;
    gender_zone?: string;
  }) {

    const { data, error } = await supabase
      .from('lockers')
      .insert({
        ...locker,
        status: 'available' as LockerStatus,
      })
      .select()
      .single();

    if (error) {
      console.error('Create locker error:', error);
      throw error;
    }
    return data;
  },

  // Update locker
  async updateLocker(lockerId: string, updates: Partial<Locker>) {
    const { data, error } = await supabase
      .from('lockers')
      .update(updates)
      .eq('id', lockerId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Assign locker to member (atomic via assign_locker_with_billing RPC).
  // assign_source='plan' => no invoice, end_date synced to membership.
  // assign_source='addon' => paid rental with GST invoice (default).
  async assignLocker(assignment: {
    locker_id: string;
    member_id: string;
    start_date: string;
    end_date?: string;
    fee_amount?: number;
    billing_months?: number;
    chargeable?: boolean;
    gst_rate?: number;
    received_by?: string;
    assign_source?: 'plan' | 'addon';
  }) {
    const { data, error } = await (supabase.rpc as any)('assign_locker_with_billing', {
      p_locker_id: assignment.locker_id,
      p_member_id: assignment.member_id,
      p_start_date: assignment.start_date,
      p_end_date: assignment.end_date ?? assignment.start_date,
      p_fee_amount: assignment.fee_amount ?? 0,
      p_billing_months: assignment.billing_months ?? 1,
      p_chargeable: !!assignment.chargeable && (assignment.fee_amount ?? 0) > 0,
      p_gst_rate: assignment.gst_rate ?? null,
      p_received_by: assignment.received_by ?? null,
      p_assign_source: assignment.assign_source ?? 'addon',
    });
    if (error) throw error;
    return data as { assignment_id: string; invoice_id: string | null; locker_id: string; branch_id: string };
  },

  // Release locker (atomic via release_locker RPC: locks assignment + locker, closes both)
  async releaseLocker(assignmentId: string, _lockerId?: string) {
    const { data, error } = await (supabase.rpc as any)('release_locker', {
      p_assignment_id: assignmentId,
      p_release_date: new Date().toISOString().split('T')[0],
    });
    if (error) throw error;
    return { success: true, ...(data as any) };
  },

  // Get member's active locker assignment
  async getMemberLocker(memberId: string) {
    const { data, error } = await supabase
      .from('locker_assignments')
      .select(`
        *,
        lockers (*)
      `)
      .eq('member_id', memberId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  // Create locker billing invoice via atomic create_manual_invoice RPC.
  // For new assignments, prefer assignLocker (assign_locker_with_billing) which
  // handles row-locking + status flip + GST invoice in one transaction.
  async createLockerInvoice(
    memberId: string,
    branchId: string,
    lockerId: string,
    lockerNumber: string,
    amount: number,
    months: number = 1
  ) {
    const { data, error } = await supabase.rpc('create_manual_invoice', {
      p_branch_id: branchId,
      p_member_id: memberId,
      p_items: [
        {
          description: `Locker #${lockerNumber} rental (${months} month${months > 1 ? 's' : ''})`,
          quantity: months,
          unit_price: amount / Math.max(months, 1),
          reference_type: 'locker',
          reference_id: lockerId,
        },
      ] as never,
      p_due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      p_notes: null,
      p_discount_amount: 0,
      p_include_gst: false,
      p_gst_rate: 0,
      p_customer_gstin: null,
    });

    if (error) throw error;
    const result = data as { success: boolean; error?: string; invoice_id?: string };
    if (!result?.success) throw new Error(result?.error || 'Locker invoice creation failed');

    return { id: result.invoice_id };
  },
};
