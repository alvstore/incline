import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';
import {
  Droplets, Snowflake, Flame, ScanLine, Dumbbell, Sparkles, IndianRupee, Calendar, Plus, CalendarCheck,
} from 'lucide-react';

interface AddOnShowcaseProps {
  memberId: string;
  memberName?: string;
  membershipId: string | null;
  branchId: string;
}

type BenefitPkg = {
  id: string;
  name: string;
  description: string | null;
  benefit_type: string;
  quantity: number;
  price: number;
  validity_days: number;
};

type PtPkg = {
  id: string;
  name: string;
  description: string | null;
  total_sessions: number;
  price: number;
  validity_days: number;
};

const TYPE_META: Record<string, { label: string; icon: typeof Droplets; tone: string }> = {
  sauna_access: { label: 'Sauna', icon: Flame, tone: 'bg-amber-100 text-amber-700' },
  sauna_session: { label: 'Sauna', icon: Flame, tone: 'bg-amber-100 text-amber-700' },
  steam_access: { label: 'Steam Room', icon: Droplets, tone: 'bg-sky-100 text-sky-700' },
  ice_bath: { label: 'Ice Bath', icon: Snowflake, tone: 'bg-blue-100 text-blue-700' },
  spa_access: { label: 'Spa', icon: Sparkles, tone: 'bg-violet-100 text-violet-700' },
  pool_access: { label: 'Pool', icon: Droplets, tone: 'bg-cyan-100 text-cyan-700' },
  body_scan: { label: '3D Body Scan', icon: ScanLine, tone: 'bg-indigo-100 text-indigo-700' },
  posture_scan: { label: 'Posture Scan', icon: ScanLine, tone: 'bg-indigo-100 text-indigo-700' },
  pt_sessions: { label: 'Personal Training', icon: Dumbbell, tone: 'bg-emerald-100 text-emerald-700' },
};

function metaFor(type: string) {
  return TYPE_META[type] ?? { label: type.replace(/_/g, ' '), icon: Sparkles, tone: 'bg-slate-100 text-slate-700' };
}

/**
 * Recovery & add-ons showcase for the member store.
 * Shows real branch add-on packages (sauna, ice bath, steam, body scan, PT) with
 * a Book action when the member already holds credits, or a Buy action otherwise.
 * Falls back to a slim informational banner when nothing is sellable at the branch.
 */
export function AddOnShowcase({ memberId, memberName, membershipId, branchId }: AddOnShowcaseProps) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'benefits' | 'pt'>('benefits');

  const { data: benefitPackages = [], isLoading: loadingBenefits } = useQuery({
    queryKey: ['store-addons-benefit-packages', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_packages')
        .select('id, name, description, benefit_type, quantity, price, validity_days')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data || []) as BenefitPkg[];
    },
  });

  const { data: ptPackages = [], isLoading: loadingPt } = useQuery({
    queryKey: ['store-addons-pt-packages', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_packages')
        .select('id, name, description, total_sessions, price, validity_days')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('price', { ascending: true });
      if (error) throw error;
      return (data || []) as PtPkg[];
    },
  });

  const { data: credits = [] } = useQuery({
    queryKey: ['store-addons-credits', memberId],
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

  const creditsByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of credits as { benefit_type: string; credits_remaining: number | null }[]) {
      const k = (c.benefit_type || '').toLowerCase();
      m.set(k, (m.get(k) || 0) + (c.credits_remaining || 0));
    }
    return m;
  }, [credits]);

  // Cheapest package per benefit type — one card per recovery service.
  const benefitCards = useMemo(() => {
    const byType = new Map<string, BenefitPkg>();
    for (const p of benefitPackages) {
      const key = (p.benefit_type || 'other').toLowerCase();
      const current = byType.get(key);
      if (!current || Number(p.price) < Number(current.price)) byType.set(key, p);
    }
    return [...byType.entries()];
  }, [benefitPackages]);

  const cheapestPt = ptPackages[0];
  const isLoading = loadingBenefits || loadingPt;

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
    );
  }

  const hasAnything = benefitCards.length > 0 || !!cheapestPt;

  if (!hasAnything) {
    return (
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">Recovery &amp; add-ons</p>
            <p className="text-xs text-muted-foreground">
              Sauna, ice bath and PT add-ons are not available at your branch right now. Ask at the front desk.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const openDrawer = (tab: 'benefits' | 'pt') => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

  return (
    <section className="space-y-3" aria-label="Recovery and add-ons">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">Recovery &amp; add-ons</h2>
          <p className="text-xs text-muted-foreground">
            Book what you already have credits for, or top up with an add-on package.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {benefitCards.map(([type, pkg]) => {
          const meta = metaFor(type);
          const Icon = meta.icon;
          const remaining = creditsByType.get(type) || 0;
          const canBook = remaining > 0;
          return (
            <Card
              key={pkg.id}
              className="rounded-2xl border-border/60 shadow-sm transition-all duration-200 hover:shadow-lg hover:shadow-primary/10"
            >
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${meta.tone}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {canBook ? (
                    <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                      {remaining} credit{remaining > 1 ? 's' : ''} left
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-full text-xs">Add-on</Badge>
                  )}
                </div>

                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {pkg.description || `${pkg.quantity} session${pkg.quantity > 1 ? 's' : ''} · valid ${pkg.validity_days} days`}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center font-semibold text-foreground">
                    <IndianRupee className="mr-0.5 h-3.5 w-3.5" />
                    {Number(pkg.price).toLocaleString('en-IN')}
                  </span>
                  <span className="inline-flex items-center">
                    <Calendar className="mr-1 h-3.5 w-3.5" />
                    {pkg.validity_days}d
                  </span>
                </div>

                {canBook ? (
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 rounded-xl"
                      onClick={() => navigate('/book?type=recovery')}
                    >
                      <CalendarCheck className="mr-1 h-4 w-4" /> Book
                    </Button>
                    <Button variant="outline" className="rounded-xl" onClick={() => openDrawer('benefits')} aria-label={`Buy more ${meta.label} credits`}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="rounded-xl" onClick={() => openDrawer('benefits')}>
                    <Plus className="mr-1 h-4 w-4" /> Buy add-on
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}

        {cheapestPt && (
          <Card className="rounded-2xl border-border/60 shadow-sm transition-all duration-200 hover:shadow-lg hover:shadow-primary/10">
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Dumbbell className="h-5 w-5" aria-hidden="true" />
                </span>
                <Badge variant="outline" className="rounded-full text-xs">PT</Badge>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Personal Training</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {cheapestPt.description || `${cheapestPt.total_sessions} sessions with a certified coach`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center font-semibold text-foreground">
                  <IndianRupee className="mr-0.5 h-3.5 w-3.5" />
                  {Number(cheapestPt.price).toLocaleString('en-IN')}
                </span>
                <span className="inline-flex items-center">
                  <Calendar className="mr-1 h-3.5 w-3.5" />
                  {cheapestPt.validity_days}d
                </span>
              </div>
              <Button variant="outline" className="rounded-xl" onClick={() => openDrawer('pt')}>
                <Plus className="mr-1 h-4 w-4" /> Buy PT package
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <PurchaseAddOnDrawer
        key={drawerTab}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        memberId={memberId}
        memberName={memberName}
        membershipId={membershipId}
        branchId={branchId}
        mode="member"
        defaultTab={drawerTab}
      />
    </section>
  );
}
