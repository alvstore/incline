import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IndianRupee, Calendar, Sparkles, Plus, Loader2 } from 'lucide-react';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';

interface EligibleAddOnsProps {
  memberId: string;
  memberName?: string;
  membershipId: string | null;
  branchId: string;
  /** Visual variant — 'compact' for dashboard strips, 'grid' for full pages */
  variant?: 'compact' | 'grid';
  /** Limit how many cards to show (compact only) */
  limit?: number;
}

type Pkg = {
  id: string;
  name: string;
  description: string | null;
  benefit_type: string;
  quantity: number;
  price: number;
  validity_days: number;
};

/**
 * Surfaces branch-available benefit add-on packages the member can purchase.
 * Hides packages whose benefit_type the member already has plenty of credits for.
 * Purchases route through the existing PurchaseAddOnDrawer (member-mode).
 */
export function EligibleAddOns({
  memberId,
  memberName,
  membershipId,
  branchId,
  variant = 'compact',
  limit = 6,
}: EligibleAddOnsProps) {
  const [open, setOpen] = useState(false);

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['eligible-addons-packages', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_packages')
        .select('id, name, description, benefit_type, quantity, price, validity_days')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data || []) as Pkg[];
    },
  });

  const { data: liveCredits = [] } = useQuery({
    queryKey: ['eligible-addons-credits', memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_benefit_credits')
        .select('benefit_type, credits_remaining, expires_at')
        .eq('member_id', memberId)
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      return data || [];
    },
  });

  const eligible = useMemo(() => {
    // Hide packages whose type already has >= 5 active credits — member is well stocked.
    const ownedByType = new Map<string, number>();
    for (const c of liveCredits as any[]) {
      const k = (c.benefit_type || '').toLowerCase();
      ownedByType.set(k, (ownedByType.get(k) || 0) + (c.credits_remaining || 0));
    }
    return packages.filter((p) => (ownedByType.get((p.benefit_type || '').toLowerCase()) || 0) < 5);
  }, [packages, liveCredits]);

  const visible = variant === 'compact' ? eligible.slice(0, limit) : eligible;

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Available to add
          </h2>
          {variant === 'compact' && eligible.length > limit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
              className="text-xs"
            >
              See all ({eligible.length})
            </Button>
          )}
        </div>

        <div className={variant === 'compact' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3 md:grid-cols-2 lg:grid-cols-3'}>
          {visible.map((p) => (
            <Card
              key={p.id}
              className="rounded-xl border-border/60 hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/20"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{p.name}</p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">{p.description}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {p.quantity}x
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" /> {p.validity_days}d validity
                  </span>
                  <span className="text-base font-bold text-primary flex items-center">
                    <IndianRupee className="h-3.5 w-3.5" />
                    {Number(p.price).toLocaleString('en-IN')}
                  </span>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => setOpen(true)}
                  disabled={!membershipId}
                  aria-label={`Add ${p.name} to plan`}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add to plan
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <PurchaseAddOnDrawer
        open={open}
        onOpenChange={setOpen}
        memberId={memberId}
        memberName={memberName}
        membershipId={membershipId}
        branchId={branchId}
        mode="member"
      />
    </>
  );
}
