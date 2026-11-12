import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeftRight, Search, User, AlertTriangle, IndianRupee } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { invalidateMembersData } from '@/lib/memberInvalidation';

interface TransferMembershipDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName?: string;
  membershipId?: string;
  branchId: string;
}

export function TransferMembershipDrawer({ open, onOpenChange, memberId, memberName, membershipId, branchId }: TransferMembershipDrawerProps) {
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const isManagement = hasAnyRole(['owner', 'admin', 'manager']);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<any>(null);
  const [isChargeable, setIsChargeable] = useState(false);
  const [transferFee, setTransferFee] = useState('');
  const [reason, setReason] = useState('');

  // Fetch membership details
  const { data: membership } = useQuery({
    queryKey: ['transfer-membership', membershipId],
    enabled: open && !!membershipId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*, membership_plans(name, price, is_transferable)')
        .eq('id', membershipId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const isTransferable = (membership as any)?.membership_plans?.is_transferable !== false;

  // Search target members
  const { data: searchResults = [] } = useQuery({
    queryKey: ['transfer-search-members', searchTerm, branchId],
    enabled: open && searchTerm.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_members', {
        search_term: searchTerm,
        p_branch_id: branchId,
        p_limit: 10,
      });
      if (error) throw error;
      return (data || []).filter((m: any) => m.id !== memberId);
    },
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTarget) throw new Error('Select a target member');
      if (!membershipId) throw new Error('No membership to transfer');
      if (!reason.trim()) throw new Error('Please provide a reason');

      if (!isManagement) {
        // Staff: Insert approval request instead of direct update
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('approval_requests').insert({
          approval_type: 'membership_transfer' as any,
          reference_id: membershipId,
          reference_type: 'membership_transfer',
          branch_id: branchId,
          requested_by: user?.id,
          request_data: {
            from_member_id: memberId,
            from_member_name: memberName,
            to_member_id: selectedTarget.id,
            to_member_name: selectedTarget.full_name,
            to_member_code: selectedTarget.member_code,
            is_chargeable: isChargeable,
            transfer_fee: isChargeable ? parseFloat(transferFee) : 0,
            reason,
            membershipId,
            // Include plan info for the approval handler to create new membership
            plan_id: membership?.plan_id,
            branch_id: branchId,
          },
          status: 'pending',
        });
        if (error) throw error;
        return { isApprovalRequest: true };
      }

      // Management: Atomic transfer — deactivate old, create new for recipient
      // 1. Fetch the current membership details
      const { data: currentMs, error: fetchErr } = await supabase
        .from('memberships')
        .select('*, membership_plans(name, price, duration_days)')
        .eq('id', membershipId)
        .single();
      if (fetchErr || !currentMs) throw new Error('Failed to fetch membership details');

      const todayStr = new Date().toISOString().split('T')[0];
      const endDate = new Date(currentMs.end_date);
      const todayDate = new Date(todayStr);
      const remainingDays = Math.max(0, Math.ceil((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)));

      // 2. Deactivate original membership
      const { error: deactivateErr } = await supabase
        .from('memberships')
        .update({ status: 'transferred' as any, end_date: todayStr })
        .eq('id', membershipId);
      if (deactivateErr) throw deactivateErr;

      // 3. Create new membership for the recipient with remaining days
      const newEndDate = new Date(todayDate);
      newEndDate.setDate(newEndDate.getDate() + remainingDays);
      const { error: insertErr } = await supabase
        .from('memberships')
        .insert({
          member_id: selectedTarget.id,
          plan_id: currentMs.plan_id,
          branch_id: currentMs.branch_id,
          start_date: todayStr,
          end_date: newEndDate.toISOString().split('T')[0],
          original_end_date: newEndDate.toISOString().split('T')[0],
          price_paid: 0,
          status: 'active',
        } as any);
      if (insertErr) throw insertErr;

      // Create transfer fee invoice if chargeable
      if (isChargeable && transferFee && parseFloat(transferFee) > 0) {
        const fee = parseFloat(transferFee);
        const { data: invoice, error: invError } = await supabase
          .from('invoices')
          .insert({
            branch_id: branchId,
            member_id: selectedTarget.id,
            subtotal: fee,
            total_amount: fee,
            amount_paid: 0,
            status: 'pending',
            due_date: new Date().toISOString().split('T')[0],
            invoice_type: 'membership_transfer',
          })
          .select('id')
          .single();

        if (!invError && invoice) {
          await supabase.from('invoice_items').insert({
            invoice_id: invoice.id,
            description: `Membership Transfer Fee from ${memberName}`,
            unit_price: fee,
            quantity: 1,
            total_amount: fee,
            reference_type: 'membership_transfer',
            reference_id: membershipId,
          });
        }
      }

      // Audit log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_logs').insert({
        action: 'MEMBERSHIP_TRANSFER',
        table_name: 'memberships',
        record_id: membershipId,
        user_id: user?.id,
        branch_id: branchId,
        old_data: { member_id: memberId, member_name: memberName },
        new_data: { member_id: selectedTarget.id, member_name: selectedTarget.full_name, fee: isChargeable ? transferFee : 0 },
        action_description: `Transferred membership from ${memberName} to ${selectedTarget.full_name}. ${isChargeable ? `Fee: ₹${transferFee}` : 'Free transfer'}. Reason: ${reason}`,
      });

      return { isApprovalRequest: false };
    },
    onSuccess: (result) => {
      if (result?.isApprovalRequest) {
        toast.success('Transfer requested. Pending Manager Approval.');
      } else {
        toast.success(`Membership transferred to ${selectedTarget?.full_name}`);
      }
      invalidateMembersData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['active-membership'] });
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      setSelectedTarget(null);
      setSearchTerm('');
      setReason('');
      setTransferFee('');
      setIsChargeable(false);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            {isManagement ? 'Transfer Membership' : 'Request Membership Transfer'}
          </SheetTitle>
          <SheetDescription>
            {isManagement
              ? `Transfer ${memberName}'s active membership to another member`
              : `Submit a transfer request for ${memberName}'s membership (requires manager approval)`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Not Transferable Warning */}
          {membership && !isTransferable && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-destructive">Transfer Not Allowed</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The <strong>{(membership as any).membership_plans?.name}</strong> plan does not allow membership transfers.
                  To enable transfers, edit the plan and toggle "Allow membership transfer" on.
                </p>
              </div>
            </div>
          )}

          {/* Current Membership */}
          {membership && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Transferring</p>
                <p className="font-semibold">{(membership as any).membership_plans?.name}</p>
                <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                  <span>{format(new Date(membership.start_date), 'dd MMM')} – {format(new Date(membership.end_date), 'dd MMM yyyy')}</span>
                  <Badge variant="secondary" className="text-[10px]">{membership.status}</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search Target Member */}
          <div className="space-y-2">
            <Label>Transfer To *</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setSelectedTarget(null); }}
                placeholder="Search by name, phone or member code..."
                className="pl-10"
              />
            </div>

            {/* Search Results */}
            {searchTerm.length >= 2 && !selectedTarget && searchResults.length > 0 && (
              <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                {searchResults.map((m: any) => (
                  <button type="button"
                    key={m.id}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => { setSelectedTarget(m); setSearchTerm(m.full_name); }}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={m.avatar_url} />
                      <AvatarFallback className="text-xs">{m.full_name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.full_name}</p>
                      <p className="text-xs text-muted-foreground">{m.member_code} · {m.phone}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{m.member_status}</Badge>
                  </button>
                ))}
              </div>
            )}

            {selectedTarget && (
              <Card className="border-success/30 bg-success/5">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium">{selectedTarget.full_name}</span>
                    <span className="text-xs text-muted-foreground">({selectedTarget.member_code})</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Chargeable Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <Label className="text-sm font-medium">Charge Transfer Fee</Label>
              <p className="text-xs text-muted-foreground">Invoice will be created for the receiving member</p>
            </div>
            <Switch checked={isChargeable} onCheckedChange={setIsChargeable} />
          </div>

          {isChargeable && (
            <div className="space-y-2">
              <Label>Transfer Fee (₹) *</Label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="number" min="0" value={transferFee} onChange={e => setTransferFee(e.target.value)} className="pl-10" placeholder="500" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Family transfer, member request" />
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
            <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              {isManagement
                ? 'This action will move the active membership to the selected member. The original member will lose access.'
                : 'This will submit a transfer request for manager approval. The membership will not be transferred until approved.'}
            </p>
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => transferMutation.mutate()}
            disabled={transferMutation.isPending || !selectedTarget || !reason.trim() || (isChargeable && !transferFee) || !isTransferable}
          >
            {transferMutation.isPending
              ? (isManagement ? 'Transferring...' : 'Submitting...')
              : (isManagement ? 'Transfer Membership' : 'Submit for Approval')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}