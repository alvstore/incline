import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { revokeHardwareAccess } from '@/services/membershipService';
import { suspendMember } from '@/services/membershipActionsService';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import {
  CancellationOptions, initialCancellationState, resolveReason, useCancellationRefund, useMembershipBill,
  type CancellationState,
} from './CancellationOptions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id: string; branch_id?: string | null; profiles?: { full_name?: string | null } | null } | null;
  /** Current plan (active/scheduled), if any. */
  membership: { id: string; start_date: string; end_date: string } | null;
}

export function SuspendMemberDrawer({ open, onOpenChange, member, membership }: Props) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<CancellationState>(initialCancellationState);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const bill = useMembershipBill(membership?.id);
  const refund = useCancellationRefund(state, membership, bill.data?.received ?? 0);
  const close = (o: boolean) => { onOpenChange(o); if (!o) { setState(initialCancellationState); setReasonError(null); } };

  const mutation = useMutation({
    mutationFn: async () => {
      const reason = resolveReason(state);
      await suspendMember({
        memberId: member!.id,
        reason,
        balanceAction: (bill.data?.due ?? 0) > 0 ? state.balanceAction : 'keep',
        refundAmount: refund,
        refundMethod: state.refundMethod,
      });
      return reason;
    },
    onSuccess: (reason) => {
      toast.success('Member suspended and plan removed.');
      revokeHardwareAccess(member!.id, `Member suspended: ${reason}`, member!.branch_id ?? undefined);
      invalidateMembersData(queryClient);
      ['memberships', 'invoices', 'payments', 'membership-bill'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      close(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Could not suspend the member'),
  });

  if (!member) return null;
  const submit = () => {
    if (!resolveReason(state)) { setReasonError(state.reasonKey === 'Other' ? 'Please describe the reason.' : 'Please choose a reason.'); return; }
    setReasonError(null);
    mutation.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive"><Ban className="h-5 w-5" aria-hidden="true" />Suspend member</SheetTitle>
          <SheetDescription>
            {member.profiles?.full_name || 'Member'} will be marked Suspended, their current plan removed and gate access blocked. You can lift the suspension later and sell a new plan.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <CancellationOptions idPrefix="suspend" state={state} onChange={setState} membership={membership} reasonError={reasonError} />
        </div>
        <div className="mt-6 flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => close(false)}>Go back</Button>
          <Button type="button" variant="destructive" className="flex-1" onClick={submit} disabled={mutation.isPending || bill.isLoading}>
            {mutation.isPending ? 'Suspending…' : 'Suspend member'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
