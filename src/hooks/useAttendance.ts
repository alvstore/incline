import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceService } from '@/services/attendanceService';
import { useToast } from '@/hooks/use-toast';

export function useAttendance(branchId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const todayAttendance = useQuery({
    queryKey: ['attendance', 'today', branchId],
    queryFn: () => attendanceService.getTodayAttendance(branchId!),
    enabled: !!branchId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const checkedInMembers = useQuery({
    queryKey: ['attendance', 'checked-in', branchId],
    queryFn: () => attendanceService.getCheckedInMembers(branchId!),
    enabled: !!branchId,
    refetchInterval: 30000,
  });

  const checkInMutation = useMutation({
    mutationFn: ({ memberId, method }: { memberId: string; method?: string }) =>
      attendanceService.checkIn(memberId, branchId!, method),
    onSuccess: (result) => {
      if (result.valid && result.success) {
        toast({
          title: 'Check-in Successful',
          description: `${result.plan_name} - ${result.days_remaining} days remaining`,
        });
        queryClient.invalidateQueries({ queryKey: ['attendance'] });
      } else {
        toast({
          title: 'Check-in Failed',
          description: result.message,
          variant: 'destructive',
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Check-in failed',
        variant: 'destructive',
      });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (memberId: string) => attendanceService.checkOut(memberId),
    onSuccess: (result) => {
      if (result.success) {
        const duration = Math.round(result.duration_minutes || 0);
        toast({
          title: 'Check-out Successful',
          description: `Duration: ${Math.floor(duration / 60)}h ${duration % 60}m`,
        });
        queryClient.invalidateQueries({ queryKey: ['attendance'] });
      } else {
        toast({
          title: 'Check-out Failed',
          description: result.message,
          variant: 'destructive',
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Check-out failed',
        variant: 'destructive',
      });
    },
  });

  const searchMemberMutation = useMutation({
    mutationFn: (query: string) => attendanceService.searchMemberForCheckIn(query, branchId!),
  });

  return {
    todayAttendance,
    checkedInMembers,
    checkIn: checkInMutation.mutate,
    checkOut: checkOutMutation.mutate,
    searchMember: searchMemberMutation.mutateAsync,
    isCheckingIn: checkInMutation.isPending,
    isCheckingOut: checkOutMutation.isPending,
    refetchToday: todayAttendance.refetch,
  };
}
