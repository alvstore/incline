import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  CreditCard,
  Loader2,
  Snowflake,
  Sparkles,
  ShieldCheck,
  Receipt,
  ArrowRight,
  Plus,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { PurchaseMembershipDrawer } from '@/components/members/PurchaseMembershipDrawer';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  discounted_price: number | null;
  duration_days: number;
  admission_fee: number | null;
  branch_id: string | null;
  is_active: boolean | null;
}

export default function MemberPlansPage() {
  const { member, activeMembership, isLoading: memberLoading } = useMemberData();
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [presetPlanId, setPresetPlanId] = useState<string | undefined>(undefined);
  const [addOnOpen, setAddOnOpen] = useState(false);

  const openPurchase = (planId?: string) => {
    setPresetPlanId(planId);
    setPurchaseOpen(true);
  };

  // Available membership plans for this branch
  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['member-portal-plans', member?.branch_id],
    enabled: !!member?.branch_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('id, name, description, price, discounted_price, duration_days, admission_fee, branch_id, is_active')
        .eq('is_active', true)
        .or(`branch_id.eq.${member!.branch_id},branch_id.is.null`)
        .order('price', { ascending: true });
      if (error) throw error;
      return (data || []) as Plan[];
    },
  });

  // Membership history (most recent first)
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['membership-history', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('id, status, start_date, end_date, plan:membership_plans(name)')
        .eq('member_id', member!.id)
        .order('start_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  // Pending invoices
  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ['my-pending-invoices', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_amount, amount_paid, status, due_date, created_at')
        .eq('member_id', member!.id)
        .neq('status', 'paid')
        .order('due_date', { ascending: true })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const totalDue = useMemo(
    () => pendingInvoices.reduce((sum, inv: any) => sum + Number(inv.total_amount || 0) - Number(inv.amount_paid || 0), 0),
    [pendingInvoices],
  );

  const daysRemaining = activeMembership?.end_date
    ? Math.max(0, differenceInDays(new Date(activeMembership.end_date), new Date()))
    : 0;

  const isFrozen = activeMembership?.status === 'frozen';

  if (memberLoading || plansLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Plans</h1>
            <p className="text-muted-foreground">
              Manage your membership cycle, renew, and explore new plans.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAddOnOpen(true)} disabled={!activeMembership}>
              <Plus className="h-4 w-4 mr-2" />
              Buy Add-Ons
            </Button>
            <Button onClick={() => openPurchase(undefined)}>
              <Sparkles className="h-4 w-4 mr-2" />
              {activeMembership ? 'Renew / Upgrade' : 'Buy Membership'}
            </Button>
          </div>
        </div>

        {/* Active membership hero */}
        {activeMembership ? (
          <Card className="overflow-hidden rounded-2xl border-border/60 shadow-lg shadow-primary/10">
            <CardContent className="grid gap-4 bg-gradient-to-r from-primary to-primary p-6 text-primary-foreground md:grid-cols-[1.4fr_1fr] md:items-center">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-card/15 backdrop-blur px-3 py-1 text-xs font-medium">
                  {isFrozen ? <Snowflake className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  {isFrozen ? 'Membership Frozen' : 'Active Membership'}
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold">{activeMembership.plan?.name || 'Your Plan'}</h2>
                <p className="text-sm text-primary-foreground/85">
                  {format(new Date(activeMembership.start_date), 'dd MMM yyyy')} →{' '}
                  {format(new Date(activeMembership.end_date), 'dd MMM yyyy')}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-card/10 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">Days remaining</p>
                  <p className="mt-2 text-2xl font-semibold">{daysRemaining}</p>
                </div>
                <div className="rounded-2xl bg-card/10 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">Outstanding dues</p>
                  <p className="mt-2 text-2xl font-semibold">₹{totalDue.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              You don't have an active membership yet — pick one below to get started.
            </span>
          </div>
        )}

        {/* Pending invoices quick view */}
        {pendingInvoices.length > 0 && (
          <Card className="border-warning/20 bg-warning/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-5 w-5 text-warning" />
                Pending invoices ({pendingInvoices.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingInvoices.slice(0, 3).map((inv: any) => {
                const due = Number(inv.total_amount || 0) - Number(inv.amount_paid || 0);
                return (
                  <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium">{inv.invoice_number || inv.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        Due {inv.due_date ? format(new Date(inv.due_date), 'dd MMM yyyy') : '—'}
                      </p>
                    </div>
                    <Badge variant="destructive">₹{due.toLocaleString()}</Badge>
                  </div>
                );
              })}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/my-invoices">
                  Pay invoices <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs: available plans, history */}
        <Tabs defaultValue="available">
          <TabsList className="rounded-xl">
            <TabsTrigger value="available" className="rounded-lg">
              Available plans
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg">
              Membership history
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="space-y-4 mt-4">
            {plans.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  No plans are available right now. Please check back soon.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => {
                  const effectivePrice = plan.discounted_price ?? plan.price;
                  const hasDiscount = plan.discounted_price != null && plan.discounted_price < plan.price;
                  return (
                    <Card key={plan.id} className="rounded-2xl border-border/60 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">{plan.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{plan.duration_days} day membership</p>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {plan.description && (
                          <p className="text-sm text-muted-foreground line-clamp-3">{plan.description}</p>
                        )}
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-bold">₹{effectivePrice.toLocaleString()}</p>
                          {hasDiscount && (
                            <p className="text-sm text-muted-foreground line-through">₹{plan.price.toLocaleString()}</p>
                          )}
                        </div>
                        {plan.admission_fee ? (
                          <p className="text-xs text-muted-foreground">
                            + ₹{Number(plan.admission_fee).toLocaleString()} one-time admission
                          </p>
                        ) : null}
                        <Button className="w-full" onClick={() => openPurchase(plan.id)}>
                          <CreditCard className="h-4 w-4 mr-2" />
                          {activeMembership ? 'Renew with this plan' : 'Buy plan'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-3 mt-4">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No membership history yet.
                </CardContent>
              </Card>
            ) : (
              history.map((m: any) => (
                <Card key={m.id} className="border-border/50">
                  <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
                    <div>
                      <p className="font-medium">{m.plan?.name || 'Membership'}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(m.start_date), 'dd MMM yyyy')} →{' '}
                        {format(new Date(m.end_date), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <Badge
                      variant={
                        m.status === 'active'
                          ? 'default'
                          : m.status === 'frozen'
                            ? 'secondary'
                            : m.status === 'expired'
                              ? 'destructive'
                              : 'outline'
                      }
                      className="capitalize gap-1"
                    >
                      {m.status === 'active' && <CheckCircle className="h-3 w-3" />}
                      {m.status === 'frozen' && <Snowflake className="h-3 w-3" />}
                      {m.status === 'expired' && <Clock className="h-3 w-3" />}
                      {m.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <PurchaseMembershipDrawer
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        memberId={member.id}
        memberName={(member as any).profiles?.full_name || member.member_code || 'Member'}
        branchId={member.branch_id}
        presetPlanId={presetPlanId}
        redirectToCheckout
        mode="member"
      />

      <PurchaseAddOnDrawer
        open={addOnOpen}
        onOpenChange={setAddOnOpen}
        memberId={member.id}
        membershipId={activeMembership?.id ?? null}
        branchId={member.branch_id}
        mode="member"
      />
    </AppLayout>
  );
}
