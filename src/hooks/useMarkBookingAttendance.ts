import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { invalidateBenefitData } from '@/lib/benefits/invalidateBenefitData';

export type AttendanceState = 'attended' | 'no_show' | 'booked';

const LABEL: Record<AttendanceState, string> = {
  attended: 'Marked attended',
  no_show: 'Marked no-show',
  booked: 'Attendance reset',
};

/**
 * Marks a facility/benefit booking attended, no-show, or resets it to booked.
 * All ledger side-effects live in the `mark_benefit_booking_attendance` RPC.
 */
export function useMarkBookingAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ bookingId, state }: { bookingId: string; state: AttendanceState }) => {
      const { data, error } = await supabase.rpc('mark_benefit_booking_attendance', {
        p_booking_id: bookingId,
        p_state: state,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Could not update attendance');
      return state;
    },
    onSuccess: (state) => {
      toast.success(LABEL[state]);
      queryClient.invalidateQueries({ queryKey: ['slot-detail'] });
      queryClient.invalidateQueries({ queryKey: ['all-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['agenda-slots'] });
      queryClient.invalidateQueries({ queryKey: ['benefit-bookings'] });
      invalidateBenefitData(queryClient);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'Could not update attendance');
    },
  });
}
