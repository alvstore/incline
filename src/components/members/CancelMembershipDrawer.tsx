import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { revokeHardwareAccess } from '@/services/membershipService';
import { cancelMembership as cancelMembershipRpc } from '@/services/membershipActionsService';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import {
  CancellationOptions, initialCancellationState, resolveReason, useCancellationRefund, useMembershipBill,
  type CancellationState,
} from './CancellationOptions';

interface CancelMembershipDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: any;
  memberName: string;
}

export function CancelMembershipDrawer({ open, onOpenChange, membership, memberName }: CancelMembershipDrawerProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<CancellationState>(initialCancellationState);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const bill = useMembershipBill(membership?.id);
  const refund = useCancellationRefund(state, membership, bill.data?.received ?? 0);

  const close = (o: boolean) => { onOpenChange(o); if (!o) { setState(initialCancellationState); setReasonError(null); } };

  const mutation = useMutation({
    mutationFn: async () => {
      const reason = resolveReason(state);
      const res = await cancelMembershipRpc({
        membershipId: membership.id,
        reason,
        refundAmount: refund,
        refundMethod: state.refundMethod,
        balanceAction: (bill.data?.due ?? 0) > 0 ? state.balanceAction : 'keep',
        idempotencyKey: `cancel-${membership.id}-${Date.now()}`,
      });
      return { reason, res };
    },
    onSuccess: ({ reason, res }) => {
      toast.success(res.refund_amount > 0 ? `Plan cancelled. ₹${res.refund_amount} refund recorded.` : 'Plan cancelled.');
      revokeHardwareAccess(membership.member_id, `Membership cancelled: ${reason}`, membership.branch_id);
      invalidateMembersData(queryClient);
      ['memberships', 'invoices', 'payments', 'membership-bill'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      close(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Could not cancel the plan'),
  });

  if (!membership) return null;

  const submit = () => {
    if (!resolveReason(state)) { setReasonError(state.reasonKey === 'Other' ? 'Please describe the reason.' : 'Please choose a reason.'); return; }
    setReasonError(null);
    mutation.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" aria-hidden="true" />Cancel plan</SheetTitle>
          <SheetDescription>
            {memberName} · {membership.membership_plans?.name || 'Plan'} · {format(new Date(membership.start_date), 'dd MMM yyyy')} – {format(new Date(membership.end_date), 'dd MMM yyyy')}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <CancellationOptions idPrefix="cancel" state={state} onChange={setState} membership={membership} reasonError={reasonError} />
        </div>
        <div className="mt-6 flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => close(false)}>Keep plan</Button>
          <Button type="button" variant="destructive" className="flex-1" onClick={submit} disabled={mutation.isPending || bill.isLoading}>
            {mutation.isPending ? 'Cancelling…' : 'Cancel plan'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
