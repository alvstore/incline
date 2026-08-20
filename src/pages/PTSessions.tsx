import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Plus, Package, Calendar, TrendingUp, Users, Dumbbell,
  Eye, EyeOff, Download, Sparkles, ChevronDown, BarChart3,
} from "lucide-react";
import {
  usePTPackages, useActiveMemberPackages, useTrainerSessions,
  useCompletePTSession, useCancelPTSession, useSchedulePTSession, useUpdatePTPackage, useRenewPtPackage,
} from "@/hooks/usePTPackages";
import { useTrainers } from "@/hooks/useTrainers";
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { AddPTPackageDrawer } from "@/components/pt/AddPTPackageDrawer";
import { EditPTPackageDrawer } from "@/components/pt/EditPTPackageDrawer";
import { CancelInvoiceDrawer } from "@/components/invoices/CancelInvoiceDrawer";
import { PendingPaymentsAlert } from "@/components/pt/PendingPaymentsAlert";
import { TodaySessionsPanel } from "@/components/pt/TodaySessionsPanel";
import { ClientsTable } from "@/components/pt/ClientsTable";
import { InsightsPanel } from "@/components/pt/InsightsPanel";
import { PackageCard } from "@/components/pt/PackageCard";
import { CommissionLedger } from "@/components/pt/CommissionLedger";

import type { PTMemberPackageRow } from "@/components/pt/ptTypes";
import { exportToCSV } from '@/lib/csvExport';
import { cn } from "@/lib/utils";

export default function PTSessionsPage() {
  const { roles } = useAuth();
  const { effectiveBranchId, branchFilter } = useBranchContext();
  const [isCreatePackageOpen, setIsCreatePackageOpen] = useState(false);
  const [isEditPackageOpen, setIsEditPackageOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<any>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [selectedPackageForSession, setSelectedPackageForSession] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);
  const [cancelInvoiceTarget, setCancelInvoiceTarget] = useState<any>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const canCancelInvoice = can.cancelInvoice(roles.map(r => r.role));
  const [newSession, setNewSession] = useState({ scheduled_at: "", duration_minutes: 60 });

  // Cmd+K: ?new=1 opens Create PT Package
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setIsCreatePackageOpen(true);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const branchId = effectiveBranchId || "";
  const queryBranchId = branchFilter || undefined;
  const { data: packages, isLoading: packagesLoading } = usePTPackages(queryBranchId, showInactive);
  const { data: trainers } = useTrainers(queryBranchId || branchId);
  const { data: activePackages, isLoading: activeLoading } = useActiveMemberPackages(queryBranchId, { 
    trainerId: roles.some(r => r.role === 'trainer') && !canManage ? user?.id : undefined 
  });
  const { data: pendingPackages } = useActiveMemberPackages(queryBranchId, { statuses: ['pending_payment'] });
  const scheduleSession = useSchedulePTSession();
  const completeSession = useCompletePTSession();
  const cancelSession = useCancelPTSession();
  const updatePackage = useUpdatePTPackage();
  const renewPackage = useRenewPtPackage();
  const [renewingId, setRenewingId] = useState<string | null>(null);

  // Session KPIs must cover every trainer in the branch — reading only the
  // first trainer made the dashboard show 0 sessions while packages existed.
  const trainerIds = useMemo(() => (trainers || []).map((t: any) => t.id).filter(Boolean), [trainers]);
  const { data: sessions, isLoading: sessionsLoading } = useTrainerSessions(trainerIds, { startDate: new Date() });

  const filteredPackages = (packages || []).filter((pkg: any) => (showInactive ? true : pkg.is_active !== false));

  const completedCount = sessions?.filter((s) => s.status === "completed").length || 0;
  const scheduledCount = sessions?.filter((s) => s.status === "scheduled").length || 0;
  const cancelledCount = sessions?.filter((s) => s.status === "cancelled").length || 0;
  const totalSessions = completedCount + scheduledCount + cancelledCount;

  const trainerRevenue = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; clients: number }>();
    activePackages?.forEach((pkg: any) => {
      const id = pkg.trainer_id || 'unknown';
      const existing = map.get(id) || { name: pkg.trainer_name || 'Unassigned', revenue: 0, clients: 0 };
      existing.revenue += pkg.price_paid || 0;
      existing.clients += 1;
      map.set(id, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [activePackages]);

  const totalRevenue = trainerRevenue.reduce((sum, t) => sum + t.revenue, 0);

  const packageTypeSplit = useMemo(() => {
    // Prefer the canonical package_type; fall back to session count so legacy
    // rows without the column still classify correctly.
    const isMonthly = (p: any) => (p.package_type ? p.package_type === 'monthly' : !(p.sessions_total > 0));
    const durationBased = activePackages?.filter(isMonthly).length || 0;
    const sessionBased = (activePackages?.length || 0) - durationBased;
    return [
      { name: 'Session-Based', value: sessionBased, color: 'hsl(var(--primary))' },
      { name: 'Monthly / Duration', value: durationBased, color: 'hsl(var(--accent))' },
    ];
  }, [activePackages]);

  const todayCount = sessions?.filter(
    (s) => new Date(s.scheduled_at).toDateString() === new Date().toDateString(),
  ).length || 0;

  const openEditDrawer = (pkg: any) => {
    setEditingPackage(pkg);
    setIsEditPackageOpen(true);
  };

  const togglePackageActive = async (pkg: any) => {
    try {
      await updatePackage.mutateAsync({ id: pkg.id, is_active: !pkg.is_active });
      toast.success(pkg.is_active ? "Package deactivated" : "Package activated");
    } catch {
      toast.error("Failed to update package status");
    }
  };

  // Continues a client on the same plan — the server starts the new term the
  // day after the current expiry so there is no gap in coverage.
  const handleRenewPackage = async (pkg: any) => {
    setRenewingId(pkg.id);
    try {
      const result = await renewPackage.mutateAsync({ memberPackageId: pkg.id });
      if ((result as any)?.error) {
        toast.error((result as any).error);
        return;
      }
      toast.success(
        `${pkg.member_name || 'Client'} renewed until ${result.expiry_date ? format(new Date(result.expiry_date), 'PP') : 'the new term end'}`,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to renew package');
    } finally {
      setRenewingId(null);
    }
  };

  const handleScheduleSession = async () => {
    const pkg = activePackages?.find((p) => p.id === selectedPackageForSession);
    if (!pkg || !newSession.scheduled_at) {
      toast.error("Please select a package and time");
      return;
    }
    try {
      await scheduleSession.mutateAsync({
        memberPackageId: pkg.id,
        trainerId: pkg.trainer_id!,
        branchId: pkg.branch_id,
        scheduledAt: new Date(newSession.scheduled_at),
        durationMinutes: newSession.duration_minutes,
      });
      toast.success("Session scheduled");
      setIsScheduleOpen(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to schedule session");
    }
  };

  const handleCompleteSession = async (sessionId: string) => {
    try {
      const result = await completeSession.mutateAsync({ sessionId });
      if (result.success) toast.success(`Session completed. ${result.sessions_remaining} sessions remaining`);
      else toast.error(result.error || "Failed to complete session");
    } catch {
      toast.error("Failed to complete session");
    }
  };

  const handleCancelSession = async (sessionId: string) => {
    try {
      await cancelSession.mutateAsync({ sessionId, reason: "Cancelled by staff" });
      toast.success("Session cancelled");
    } catch {
      toast.error("Failed to cancel session");
    }
  };

  const canManage = roles.some(r => ['owner', 'admin', 'manager'].includes(r.role));

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Coaching Studio
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Personal Training</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Run today's sessions, track every client's package, and manage what you sell.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl"
              onClick={() => {
                const rows = (activePackages || []).map((p: any) => ({
                  Member: p.member_name || '',
                  Trainer: p.trainer_name || '',
                  Package: p.package_name || '',
                  'Sessions Used': p.sessions_used || 0,
                  'Sessions Total': p.sessions_total || 0,
                  'Price Paid': p.price_paid || 0,
                  Status: p.status || '',
                  'Start Date': p.start_date || '',
                  'Expiry Date': p.expiry_date || '',
                }));
                exportToCSV(rows, 'pt_sessions');
              }}
            >
              <Download className="h-4 w-4" aria-hidden /> Export
            </Button>
            <Button onClick={() => setIsScheduleOpen(true)} variant="outline" className="rounded-xl gap-1.5">
              <Calendar className="h-4 w-4" aria-hidden /> Schedule
            </Button>
            {canManage && (
              <Button
                onClick={() => setIsCreatePackageOpen(true)}
                className="rounded-xl bg-gradient-to-r from-primary to-primary/90 shadow-lg shadow-primary/20 transition-all duration-200 hover:shadow-xl"
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Create Package
              </Button>
            )}
          </div>
        </div>

        {/* KPI Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={<Dumbbell className="h-5 w-5" />}
            tint="amber"
            label="Sessions Today"
            value={todayCount}
            sub="Scheduled for today"
          />
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            tint="emerald"
            label="Active Clients"
            value={activePackages?.length || 0}
            sub={`Across ${trainerRevenue.length || 0} trainer${trainerRevenue.length === 1 ? '' : 's'}`}
          />
          <KpiCard
            icon={<Package className="h-5 w-5" />}
            tint="indigo"
            label="Total Packages"
            value={packages?.length || 0}
            sub={`${filteredPackages.length} visible`}
          />
          <KpiCard
            icon={<TrendingUp className="h-5 w-5" />}
            tint="sky"
            label="Completion Rate"
            value={`${totalSessions ? Math.round((completedCount / totalSessions) * 100) : 0}%`}
            sub={`${completedCount} of ${totalSessions || 0} completed`}
          />
        </div>

        {/* Money that hasn't landed yet gets one compact strip, not a table. */}
        <PendingPaymentsAlert
          rows={(pendingPackages || []) as PTMemberPackageRow[]}
          canCancelInvoice={canCancelInvoice}
          onCancelInvoice={setCancelInvoiceTarget}
        />

        <Tabs defaultValue="today" className="space-y-4">
          <TabsList className="rounded-xl bg-muted p-1">
            <TabsTrigger value="today" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              Today's Sessions
            </TabsTrigger>
            <TabsTrigger value="clients" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              Clients
            </TabsTrigger>
            <TabsTrigger value="packages" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              Packages
            </TabsTrigger>
            {canManage && (
              <TabsTrigger value="commissions" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                Commissions
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="commissions" className="animate-in fade-in-50 duration-500">
            <CommissionLedger branchId={queryBranchId ?? null} />
          </TabsContent>


          <TabsContent value="today">
            <TodaySessionsPanel
              sessions={(sessions || []) as any}
              loading={sessionsLoading}
              busy={completeSession.isPending || cancelSession.isPending}
              onComplete={handleCompleteSession}
              onCancel={handleCancelSession}
              onSchedule={() => setIsScheduleOpen(true)}
            />
          </TabsContent>

          <TabsContent value="clients">
            <ClientsTable
              rows={(activePackages || []) as PTMemberPackageRow[]}
              loading={activeLoading}
              renewingId={renewingId}
              renewPending={renewPackage.isPending}
              canCancelInvoice={canCancelInvoice}
              onSchedule={() => setIsScheduleOpen(true)}
              onRenew={handleRenewPackage}
              onCancelInvoice={(pkg) =>
                setCancelInvoiceTarget({
                  id: pkg.invoice_id,
                  invoice_number: pkg.invoice_number ?? null,
                  total_amount: pkg.price_paid,
                  amount_paid: 0,
                  status: 'pending',
                })
              }
            />
          </TabsContent>

          <TabsContent value="packages" className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <Switch checked={showInactive} onCheckedChange={setShowInactive} id="show-inactive" />
                <Label htmlFor="show-inactive" className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                  {showInactive ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                  Show inactive
                </Label>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {filteredPackages.length} package{filteredPackages.length === 1 ? '' : 's'}
              </span>
            </div>

            {packagesLoading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
                    <div className="h-1.5 bg-muted" />
                    <CardContent className="space-y-3 p-5">
                      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredPackages.length === 0 ? (
              <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
                <CardContent className="flex flex-col items-center py-16 text-center">
                  <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                    <Package className="h-6 w-6" />
                  </span>
                  <p className="text-base font-semibold text-foreground">
                    {showInactive ? "No PT packages yet" : "No active PT packages"}
                  </p>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    {showInactive
                      ? "Create your first coaching package to get started."
                      : "Create a package, or toggle 'Show inactive' to see archived ones."}
                  </p>
                  {canManage && (
                    <Button onClick={() => setIsCreatePackageOpen(true)} className="mt-5 rounded-xl">
                      <Plus className="mr-2 h-4 w-4" aria-hidden /> Create package
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredPackages.map((pkg: any) => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    canManage={canManage}
                    onEdit={() => openEditDrawer(pkg)}
                    onToggle={() => togglePackageActive(pkg)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Analytics live below the operational surface, collapsed by default. */}
        <Collapsible open={insightsOpen} onOpenChange={setInsightsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between rounded-2xl bg-card py-6 text-left shadow-sm hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
                Insights &amp; revenue
              </span>
              <ChevronDown
                className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', insightsOpen && 'rotate-180')}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <InsightsPanel
              trainerRevenue={trainerRevenue}
              packageTypeSplit={packageTypeSplit}
              totalRevenue={totalRevenue}
              completedCount={completedCount}
              scheduledCount={scheduledCount}
              cancelledCount={cancelledCount}
              canManage={canManage}
              onCreatePackage={() => setIsCreatePackageOpen(true)}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      <AddPTPackageDrawer open={isCreatePackageOpen} onOpenChange={setIsCreatePackageOpen} branchId={branchId} />
      <EditPTPackageDrawer open={isEditPackageOpen} onOpenChange={setIsEditPackageOpen} package={editingPackage} />

      <Sheet open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Schedule PT session</SheetTitle>
            <SheetDescription>Book a personal training session for an active client package.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pt-package-select">Member package *</Label>
              <Select value={selectedPackageForSession} onValueChange={setSelectedPackageForSession}>
                <SelectTrigger id="pt-package-select">
                  <SelectValue placeholder="Select member package" />
                </SelectTrigger>
                <SelectContent>
                  {activePackages?.map((pkg) => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      {pkg.member_name} - {pkg.package_name} ({pkg.sessions_remaining} left)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pt-schedule-at">Date &amp; time *</Label>
              <Input
                id="pt-schedule-at"
                type="datetime-local"
                value={newSession.scheduled_at}
                onChange={(e) => setNewSession({ ...newSession, scheduled_at: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pt-duration">Duration (minutes)</Label>
              <Input
                id="pt-duration"
                type="number"
                value={newSession.duration_minutes}
                onChange={(e) => setNewSession({ ...newSession, duration_minutes: parseInt(e.target.value) || 60 })}
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setIsScheduleOpen(false)}>Cancel</Button>
            <Button onClick={handleScheduleSession} disabled={scheduleSession.isPending}>
              {scheduleSession.isPending ? "Scheduling…" : "Schedule"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CancelInvoiceDrawer
        open={!!cancelInvoiceTarget}
        onOpenChange={(open) => !open && setCancelInvoiceTarget(null)}
        invoice={cancelInvoiceTarget}
      />
    </AppLayout>
  );
}

function KpiCard({
  icon, tint, label, value, sub,
}: {
  icon: React.ReactNode;
  tint: 'indigo' | 'emerald' | 'amber' | 'sky';
  label: string;
  value: number | string;
  sub: string;
}) {
  const tintMap = {
    indigo: 'bg-primary/10 text-primary',
    emerald: 'bg-success/10 text-success',
    amber: 'bg-warning/10 text-warning',
    sky: 'bg-info/10 text-info',
  } as const;
  return (
    <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-primary/10">
      <CardContent className="space-y-3 p-5">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-full', tintMap[tint])} aria-hidden>
          {icon}
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}
