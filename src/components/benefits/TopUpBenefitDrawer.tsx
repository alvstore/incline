import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, IndianRupee } from 'lucide-react';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';

interface TopUpBenefitDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  membershipId: string;
  branchId: string;
  benefitName: string;
  benefitTypeId: string;
  benefitType: string;
}

export function TopUpBenefitDrawer({
  open,
  onOpenChange,
  memberId,
  membershipId,
  branchId,
  benefitName,
  benefitTypeId,
  benefitType,
}: TopUpBenefitDrawerProps) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(5);
  const [price, setPrice] = useState(500);
  const [submitting, setSubmitting] = useState(false);
  const [gstRate, setGstRate] = useState(5);
  // Stable idempotency key — reuses across retries within the same drawer session.
  const idempotencyKey = useStableIdempotencyKey(memberId, 'topup', `${benefitTypeId}`);
  const handleSubmit = async () => {
    if (quantity <= 0 || price < 0) {
      toast.error('Please enter valid quantity and price');
      return;
    }
    setSubmitting(true);
    try {
      // Authoritative atomic top-up: invoice + GST + payment + credit grant
      const idem = idempotencyKey;
      const { data, error } = await supabase.rpc('purchase_benefit_topup', {
        p_member_id: memberId,
        p_membership_id: membershipId,
        p_benefit_type_id: benefitTypeId,
        p_credits: quantity,
        p_unit_price: price / quantity,
        p_gst_rate: gstRate,
        p_payment_method: 'cash',
        p_branch_id: branchId,
        p_idempotency_key: idem,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Failed to top up');

      toast.success(`Added ${quantity} ${benefitName} sessions`);
      queryClient.invalidateQueries({ queryKey: ['member-benefit-usage-summary'] });
      queryClient.invalidateQueries({ queryKey: ['member-plan-benefits'] });
      queryClient.invalidateQueries({ queryKey: ['member-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['member-payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
      setQuantity(5);
      setPrice(500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to top up benefit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Top Up: {benefitName}
          </SheetTitle>
          <SheetDescription>
            Add extra sessions and generate an invoice
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          <div className="space-y-2">
            <Label>Number of Sessions</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
            />
          </div>

          <div className="space-y-2">
            <Label>Total Price (₹)</Label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(parseInt(e.target.value) || 0)}
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              ₹{quantity > 0 ? Math.round(price / quantity) : 0} per session
            </p>
          </div>

          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Sessions to add</span>
              <span className="font-medium">+{quantity}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Invoice amount</span>
              <span className="font-medium">₹{price.toLocaleString()}</span>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={submitting || quantity <= 0}
            onClick={handleSubmit}
          >
            {submitting ? 'Processing...' : `Add ${quantity} Sessions & Generate Invoice`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
