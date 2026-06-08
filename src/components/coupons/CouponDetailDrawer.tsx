import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Share2, Calendar, Tag, Hash, Users, Clock } from 'lucide-react';
import { format, isPast, differenceInDays } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface CouponDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coupon: any | null;
  onShare: () => void;
}

export function CouponDetailDrawer({ open, onOpenChange, coupon, onShare }: CouponDetailDrawerProps) {
  // Try to find invoices that used this code by checking notes field
  const { data: usageHistory = [] } = useQuery({
    queryKey: ['coupon-usage', coupon?.code],
    queryFn: async () => {
      if (!coupon?.code) return [];
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_amount, discount_amount, created_at, member_id, members!inner(id, user_id, profiles:user_id(full_name))')
        .ilike('notes', `%${coupon.code}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return data || [];
    },
    enabled: !!coupon?.code,
  });

  if (!coupon) return null;

  const isExpired = coupon.valid_until && isPast(new Date(coupon.valid_until));
  const daysLeft = coupon.valid_until ? differenceInDays(new Date(coupon.valid_until), new Date()) : null;

  const getStatusBadge = () => {
    if (!coupon.is_active) return <Badge variant="secondary">Inactive</Badge>;
    if (isExpired) return <Badge variant="destructive">Expired</Badge>;
    return <Badge className="bg-success/15 text-success border-success/25">Active</Badge>;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Coupon Details
          </SheetTitle>
          <SheetDescription>View coupon information and usage history</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Coupon Summary Card */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xl font-bold tracking-wider text-foreground">{coupon.code}</span>
              {getStatusBadge()}
            </div>
            {(coupon as any).description && (
              <p className="text-sm text-muted-foreground">{(coupon as any).description}</p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                {coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                {coupon.times_used || 0} / {coupon.max_uses || '∞'} used
              </div>
              {coupon.min_purchase > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  Min: ₹{coupon.min_purchase}
                </div>
              )}
              {coupon.valid_until && (
                <div className={`flex items-center gap-2 ${isExpired ? 'text-destructive' : daysLeft !== null && daysLeft <= 7 ? 'text-warning' : 'text-muted-foreground'}`}>
                  <Calendar className="h-3.5 w-3.5" />
                  {isExpired ? 'Expired' : `${daysLeft}d left`}
                </div>
              )}
            </div>
          </div>

          <Button onClick={onShare} variant="outline" className="w-full">
            <Share2 className="mr-2 h-4 w-4" /> Share via Broadcast
          </Button>

          <Separator />

          {/* Usage History */}
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <Users className="h-4 w-4" /> Usage History ({usageHistory.length})
            </h3>
            {usageHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No usage records found</p>
            ) : (
              <div className="space-y-2">
                {usageHistory.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <div>
                      <p className="font-medium text-foreground">
                        {inv.members?.profiles?.full_name || 'Unknown Member'}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(inv.created_at), 'dd MMM yyyy, hh:mm a')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">₹{inv.total_amount}</p>
                      {inv.discount_amount > 0 && (
                        <p className="text-xs text-success">-₹{inv.discount_amount} saved</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
