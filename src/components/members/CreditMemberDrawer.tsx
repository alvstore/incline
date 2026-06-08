import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Wallet, Award, Plus, IndianRupee } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { toast } from 'sonner';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';

interface CreditMemberDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  branchId: string;
}

export function CreditMemberDrawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  branchId,
}: CreditMemberDrawerProps) {
  const queryClient = useQueryClient();
  const [walletAmount, setWalletAmount] = useState<string>('');
  const [points, setPoints] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const idempotencyKey = useStableIdempotencyKey(memberId, 'credit-member', '');

  const wAmt = useMemo(() => Number(walletAmount) || 0, [walletAmount]);
  const pPts = useMemo(() => parseInt(points) || 0, [points]);
  const canSubmit = (wAmt > 0 || pPts > 0) && reason.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('credit_member' as any, {
        p_member_id: memberId,
        p_branch_id: branchId,
        p_wallet_amount: wAmt,
        p_reward_points: pPts,
        p_reason: reason.trim(),
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      const parts: string[] = [];
      if (wAmt > 0) parts.push(`₹${wAmt.toLocaleString('en-IN')} wallet`);
      if (pPts > 0) parts.push(`${pPts} points`);
      toast.success(`Credited ${parts.join(' + ')} to ${memberName}`);
      queryClient.invalidateQueries({ queryKey: ['member-wallet', memberId] });
      queryClient.invalidateQueries({ queryKey: ['member-wallet-balance', memberId] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions', memberId] });
      queryClient.invalidateQueries({ queryKey: ['rewards-ledger', memberId] });
      queryClient.invalidateQueries({ queryKey: ['member-details'] });
      invalidateMembersData(queryClient);
      setWalletAmount('');
      setPoints('');
      setReason('');
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to credit member');
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Credit Member — {memberName}
          </SheetTitle>
          <SheetDescription>
            Add wallet balance and/or reward points. This is logged for audit.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-success" /> Wallet Amount (₹)
            </Label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                step="1"
                placeholder="0"
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm">
              <Award className="h-4 w-4 text-primary" /> Reward Points
            </Label>
            <Input
              type="number"
              min={0}
              step="1"
              placeholder="0"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Reason</Label>
            <Textarea
              rows={3}
              placeholder="e.g. Goodwill credit for billing issue"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {(wAmt > 0 || pPts > 0) && (
            <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
              {wAmt > 0 && (
                <div className="flex justify-between">
                  <span>Wallet credit</span>
                  <span className="font-semibold text-success">+₹{wAmt.toLocaleString('en-IN')}</span>
                </div>
              )}
              {pPts > 0 && (
                <div className="flex justify-between">
                  <span>Reward points</span>
                  <span className="font-semibold text-primary">+{pPts}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Crediting…' : 'Credit Member'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
