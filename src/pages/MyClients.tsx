import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useTrainerData } from '@/hooks/useMemberData';
import {
  AlertCircle,
  Calendar,
  Dumbbell,
  Eye,
  MessageCircle,
  Phone,
  Receipt,
  Ruler,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { RecordMeasurementDrawer } from '@/components/members/RecordMeasurementDrawer';
import { MeasurementProgressView } from '@/components/members/MeasurementProgressView';
import { MarkPtStatusMenu } from '@/components/pt/MarkPtStatusMenu';
import { TrainerBillingTab } from '@/components/pt/TrainerBillingTab';
import { ClientVisitRhythm } from '@/components/pt/ClientVisitRhythm';
import { useTrainerClientVisits } from '@/hooks/useTrainerClientVisits';
import { inr, paymentStateMeta, useTrainerBilling } from '@/hooks/useTrainerBilling';

const cardShell =
  'rounded-2xl border-0 bg-card shadow-lg shadow-primary/5 transition-all duration-200 hover:shadow-xl hover:shadow-primary/10';

export default function MyClients() {
  const { trainer, generalClients, ptClients, isLoading: trainerLoading } = useTrainerData();
  const [measurementDrawer, setMeasurementDrawer] = useState<{ open: boolean; memberId: string; memberName: string }>({ open: false, memberId: '', memberName: '' });
  const [progressDrawer, setProgressDrawer] = useState<{ open: boolean; memberId: string; memberName: string }>({ open: false, memberId: '', memberName: '' });

  const { data: billingRows = [] } = useTrainerBilling(trainer?.id, !!trainer);
  const { data: visits = {}, isLoading: visitsLoading } = useTrainerClientVisits(!!trainer, 7);
  const billingByPackage = useMemo(() => {
    const map: Record<string, (typeof billingRows)[number]> = {};
    billingRows.forEach((r) => { map[r.package_row_id] = r; });
    return map;
  }, [billingRows]);


  // Session history for PT clients
  const { data: sessionStats = {} } = useQuery({
    queryKey: ['client-session-stats', trainer?.id],
    enabled: !!trainer && ptClients.length > 0,
    queryFn: async (): Promise<Record<string, { completed: number; total: number }>> => {
      const packageIds = ptClients.map((c: { id: string }) => c.id);
      const { data, error } = await supabase
        .from('pt_sessions')
        .select('member_pt_package_id, status')
        .eq('trainer_id', trainer!.id)
        .in('member_pt_package_id', packageIds);
      if (error) throw error;

      const packageToMember: Record<string, string> = {};
      ptClients.forEach((c: { id: string; member_id: string }) => { packageToMember[c.id] = c.member_id; });

      const stats: Record<string, { completed: number; total: number }> = {};
      (data || []).forEach((session) => {
        const memberId = packageToMember[session.member_pt_package_id];
        if (!memberId) return;
        if (!stats[memberId]) stats[memberId] = { completed: 0, total: 0 };
        stats[memberId].total++;
        if (session.status === 'completed') stats[memberId].completed++;
      });
      return stats;
    },
  });

  if (trainerLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!trainer) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-10 w-10 text-amber-500" aria-hidden />
          <h1 className="text-xl font-bold">No trainer profile found</h1>
          <p className="text-sm text-muted-foreground">Your account is not linked to a trainer record.</p>
        </div>
      </AppLayout>
    );
  }

  const totalClients = generalClients.length + ptClients.length;
  const outstanding = billingRows
    .filter((r) => !['cancelled', 'refunded'].includes(r.payment_state))
    .reduce((s, r) => s + r.balance_due, 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Hero */}
        <section className="rounded-2xl bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground shadow-lg">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My Clients</h1>
              <p className="mt-1 text-sm opacity-85">
                Coaching roster, progress and package payments in one place
              </p>
            </div>
            <dl className="flex flex-wrap gap-6">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider opacity-75">Total</dt>
                <dd className="text-2xl font-bold tabular-nums">{totalClients}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider opacity-75">General</dt>
                <dd className="text-2xl font-bold tabular-nums">{generalClients.length}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider opacity-75">Personal</dt>
                <dd className="text-2xl font-bold tabular-nums">{ptClients.length}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider opacity-75">Dues</dt>
                <dd className="text-2xl font-bold tabular-nums">{inr(outstanding)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <Tabs defaultValue="general">
          <TabsList className="rounded-xl">
            <TabsTrigger value="general" className="gap-2 rounded-lg">
              <User className="h-4 w-4" aria-hidden /> General ({generalClients.length})
            </TabsTrigger>
            <TabsTrigger value="pt" className="gap-2 rounded-lg">
              <Dumbbell className="h-4 w-4" aria-hidden /> Personal ({ptClients.length})
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-2 rounded-lg">
              <Receipt className="h-4 w-4" aria-hidden /> Billing
            </TabsTrigger>
          </TabsList>

          {/* ---------------- General contact cards ---------------- */}
          <TabsContent value="general" className="mt-4">
            {generalClients.length === 0 ? (
              <Card className={cardShell}>
                <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
                  <Users className="h-10 w-10 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">No general training clients assigned</p>
                  <p className="text-xs text-muted-foreground">
                    Ask the front desk to assign members to you.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {generalClients.map((client: any) => {
                  const clientName = client.profile?.full_name || client.member_code || 'Unknown';
                  const phone: string | undefined = client.profile?.phone;
                  return (
                    <Card key={client.id} className={cardShell}>
                      <CardContent className="p-5">
                        <div className="flex items-start gap-3">
                          <Avatar className="h-12 w-12 shrink-0">
                            <AvatarImage src={client.profile?.avatar_url} alt="" />
                            <AvatarFallback>{clientName.charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h2 className="truncate font-semibold text-foreground">{clientName}</h2>
                                <p className="truncate text-xs text-muted-foreground">{client.member_code}</p>
                              </div>
                              <Badge className="rounded-full border-0 bg-primary/10 text-xs text-primary">
                                General
                              </Badge>
                            </div>
                            {client.fitness_goals && (
                              <span className="mt-2 inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                                {client.fitness_goals}
                              </span>
                            )}
                          </div>
                        </div>

                        {phone && (
                          <div className="mt-4 flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              className="min-h-[44px] flex-1 justify-start gap-2"
                            >
                              <a href={`tel:${phone}`} aria-label={`Call ${clientName}`}>
                                <Phone className="h-4 w-4" aria-hidden />
                                <span className="truncate">{phone}</span>
                              </a>
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              asChild
                              className="h-11 w-11 shrink-0"
                            >
                              <a
                                href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`WhatsApp ${clientName}`}
                              >
                                <MessageCircle className="h-4 w-4" aria-hidden />
                              </a>
                            </Button>
                          </div>
                        )}

                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <Button variant="secondary" size="sm" asChild className="min-h-[44px] gap-1">
                            <Link to="/trainer-plan-builder">
                              <Dumbbell className="h-4 w-4" aria-hidden />
                              <span className="hidden sm:inline">Plan</span>
                            </Link>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-[44px] gap-1"
                            onClick={() => setMeasurementDrawer({ open: true, memberId: client.id, memberName: clientName })}
                          >
                            <Ruler className="h-4 w-4" aria-hidden />
                            <span className="hidden sm:inline">Record</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-[44px] gap-1"
                            onClick={() => setProgressDrawer({ open: true, memberId: client.id, memberName: clientName })}
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                            <span className="hidden sm:inline">Progress</span>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ---------------- PT clients ---------------- */}
          <TabsContent value="pt" className="mt-4">
            {ptClients.length === 0 ? (
              <Card className={cardShell}>
                <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
                  <Dumbbell className="h-10 w-10 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">No active PT clients</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {ptClients.map((client: any) => {
                  const clientName = client.member?.profile?.full_name || client.member?.member_code || 'Unknown';
                  const pkgType = (client.package_type ?? client.package?.package_type ?? 'session_based') as 'session_based' | 'monthly';
                  const stats = sessionStats[client.member_id] || { completed: 0, total: 0 };
                  const remaining = typeof client.sessions_remaining === 'number' ? client.sessions_remaining : null;
                  const total = client.sessions_total ?? null;
                  const used = remaining !== null && total !== null ? Math.max(0, total - remaining) : stats.completed;
                  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
                  const daysLeft = client.expiry_date
                    ? Math.ceil((new Date(client.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;
                  const billing = billingByPackage[client.id];
                  const payMeta = billing ? paymentStateMeta(billing.payment_state) : null;
                  const phone: string | undefined = client.member?.profile?.phone;

                  return (
                    <Card key={client.id} className={cardShell}>
                      <CardContent className="p-5">
                        <div className="flex items-start gap-3">
                          <Avatar className="h-12 w-12 shrink-0">
                            <AvatarImage src={client.member?.profile?.avatar_url} alt="" />
                            <AvatarFallback>{clientName.charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h2 className="truncate font-semibold text-foreground">{clientName}</h2>
                                <p className="truncate text-xs text-muted-foreground">
                                  {client.member?.member_code} · {client.package?.name}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge className="rounded-full border-0 bg-primary/10 text-xs text-primary">
                                  {pkgType === 'monthly' ? 'Monthly' : 'Sessions'}
                                </Badge>
                                {payMeta && (
                                  <Badge className={`rounded-full border-0 text-xs ${payMeta.className}`}>
                                    {billing!.balance_due > 0
                                      ? `${payMeta.label} · ${inr(billing!.balance_due)}`
                                      : payMeta.label}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {billing?.payment_due_date && billing.balance_due > 0 && (
                              <p className="mt-1 text-xs font-medium text-destructive">
                                Payment due {format(new Date(billing.payment_due_date), 'dd MMM yyyy')}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Progress */}
                        <div className="mt-4">
                          {pkgType === 'session_based' && total ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium">{used} / {total} sessions</span>
                                <span className="text-muted-foreground">{remaining ?? 0} left</span>
                              </div>
                              <div
                                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                                role="progressbar"
                                aria-valuenow={pct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${clientName} session progress`}
                              >
                                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs">
                              <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
                              <span>
                                Expires {client.expiry_date ? format(new Date(client.expiry_date), 'dd MMM yyyy') : '—'}
                              </span>
                              {daysLeft !== null && (
                                <Badge
                                  className={`rounded-full border-0 text-xs ${daysLeft <= 7 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                                >
                                  {daysLeft > 0 ? `${daysLeft}d left` : 'Expired'}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-[44px] gap-1"
                            onClick={() => setMeasurementDrawer({ open: true, memberId: client.member_id, memberName: clientName })}
                          >
                            <Ruler className="h-4 w-4" aria-hidden /> Record
                          </Button>
                          <MarkPtStatusMenu
                            memberPackageId={client.id}
                            trainerId={trainer.id}
                            memberName={clientName}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-[44px] gap-1"
                            aria-label={`View progress for ${clientName}`}
                            onClick={() => setProgressDrawer({ open: true, memberId: client.member_id, memberName: clientName })}
                          >
                            <Eye className="h-4 w-4" aria-hidden /> Progress
                          </Button>
                          {phone && (
                            <Button
                              variant="ghost"
                              size="icon"
                              asChild
                              className="ml-auto h-11 w-11"
                            >
                              <a href={`tel:${phone}`} aria-label={`Call ${clientName}`}>
                                <Phone className="h-4 w-4" aria-hidden />
                              </a>
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ---------------- Billing ---------------- */}
          <TabsContent value="billing" className="mt-4">
            <TrainerBillingTab trainerId={trainer.id} enabled={!!trainer} />
          </TabsContent>
        </Tabs>
      </div>

      <RecordMeasurementDrawer
        open={measurementDrawer.open}
        onOpenChange={(open) => setMeasurementDrawer((prev) => ({ ...prev, open }))}
        memberId={measurementDrawer.memberId}
        memberName={measurementDrawer.memberName}
      />

      <Sheet open={progressDrawer.open} onOpenChange={(open) => setProgressDrawer((prev) => ({ ...prev, open }))}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" aria-hidden />
              Progress — {progressDrawer.memberName}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            {progressDrawer.memberId && <MeasurementProgressView memberId={progressDrawer.memberId} />}
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
