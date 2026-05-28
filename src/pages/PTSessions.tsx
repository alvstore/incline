import { useState, useMemo, useEffect } from "react";
import { format, differenceInDays } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Plus, Package, Calendar, Check, X, Edit, TrendingUp, Users, Dumbbell,
  Eye, EyeOff, Crown, IndianRupee, Download, Sparkles, CalendarDays, Clock,
} from "lucide-react";
import {
  usePTPackages, useActiveMemberPackages, useTrainerSessions,
  useCompletePTSession, useCancelPTSession, useSchedulePTSession, useUpdatePTPackage,
} from "@/hooks/usePTPackages";
import { useTrainers } from "@/hooks/useTrainers";
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { AddPTPackageDrawer } from "@/components/pt/AddPTPackageDrawer";
import { EditPTPackageDrawer } from "@/components/pt/EditPTPackageDrawer";
import { exportToCSV } from '@/lib/csvExport';
import { cn } from "@/lib/utils";

const SESSION_TYPES = [
  { value: "per_session", label: "Per Session" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "custom", label: "Custom" },
];

type Tier = 'silver' | 'gold' | 'platinum' | 'default';

function inferTier(name: string | null | undefined): Tier {
  const n = (name || '').toLowerCase();
  if (n.includes('platinum') || n.includes('elite')) return 'platinum';
  if (n.includes('gold')) return 'gold';
  if (n.includes('silver') || n.includes('basic') || n.includes('foundation')) return 'silver';
  return 'default';
}

const TIER_RIBBON: Record<Tier, string> = {
  silver: 'bg-gradient-to-r from-slate-400 via-slate-300 to-zinc-400',
  gold: 'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500',
  platinum: 'bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500',
  default: 'bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500',
};

const TIER_ICON_BG: Record<Tier, string> = {
  silver: 'bg-slate-100 text-slate-600',
  gold: 'bg-amber-100 text-amber-700',
  platinum: 'bg-violet-100 text-violet-700',
  default: 'bg-indigo-100 text-indigo-700',
};

const AVATAR_PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
];

function initialsOf(name: string | null | undefined): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || name[0]?.toUpperCase() || '–';
}

function avatarColor(name: string | null | undefined): string {
  const s = (name || '?');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function formatINR(value: number): string {
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`;
  return `₹${value.toLocaleString('en-IN')}`;
}

export default function PTSessionsPage() {
  const { roles } = useAuth();
  const { effectiveBranchId, branchFilter } = useBranchContext();
  const [isCreatePackageOpen, setIsCreatePackageOpen] = useState(false);
  const [isEditPackageOpen, setIsEditPackageOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<any>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [selectedPackageForSession, setSelectedPackageForSession] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);
  const [newSession, setNewSession] = useState({
    scheduled_at: "",
    duration_minutes: 60,
  });

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
  const { data: packages, isLoading: packagesLoading } = usePTPackages(queryBranchId);
  const { data: trainers } = useTrainers(queryBranchId || branchId);
  const { data: activePackages } = useActiveMemberPackages(queryBranchId);
  const scheduleSession = useSchedulePTSession();
  const completeSession = useCompletePTSession();
  const cancelSession = useCancelPTSession();
  const updatePackage = useUpdatePTPackage();

  const firstTrainerId = trainers?.[0]?.id;
  const { data: sessions } = useTrainerSessions(firstTrainerId || "", { startDate: new Date() });

  const filteredPackages = (packages || []).filter((pkg: any) =>
    showInactive ? true : pkg.is_active !== false
  );

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
  const topPerformer = trainerRevenue[0];
  const topThree = trainerRevenue.slice(0, 3);
  const topRevenue = topThree[0]?.revenue || 0;

  const packageTypeSplit = useMemo(() => {
    const sessionBased = activePackages?.filter((p: any) => p.sessions_total > 0).length || 0;
    const durationBased = activePackages?.filter((p: any) => p.sessions_total === 0).length || 0;
    return [
      { name: 'Session-Based', value: sessionBased, color: 'hsl(238 84% 60%)' },
      { name: 'Duration-Based', value: durationBased, color: 'hsl(258 90% 66%)' },
    ];
  }, [activePackages]);

  const typeTotal = packageTypeSplit.reduce((s, p) => s + p.value, 0);

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
      <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" /> Coaching Studio
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Personal Training Packages</h1>
            <p className="text-sm text-slate-500 max-w-2xl">
              Design, sell and track every 1-on-1 coaching package across your branches.
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
              <Download className="h-4 w-4" /> Export
            </Button>
            {canManage && (
              <Button
                onClick={() => setIsCreatePackageOpen(true)}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 transition-all duration-200"
              >
                <Plus className="mr-2 h-4 w-4" /> Create Package
              </Button>
            )}
          </div>
        </div>

        {/* KPI Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={<Package className="h-5 w-5" />}
            tint="indigo"
            label="Total Packages"
            value={packages?.length || 0}
            sub={`${filteredPackages.length} visible`}
          />
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            tint="emerald"
            label="Active Memberships"
            value={activePackages?.length || 0}
            sub={`Across ${trainerRevenue.length || 0} trainer${trainerRevenue.length === 1 ? '' : 's'}`}
          />
          <KpiCard
            icon={<Dumbbell className="h-5 w-5" />}
            tint="amber"
            label="Sessions Today"
            value={sessions?.filter((s) => new Date(s.scheduled_at).toDateString() === new Date().toDateString()).length || 0}
            sub="Scheduled for today"
          />
          <KpiCard
            icon={<TrendingUp className="h-5 w-5" />}
            tint="sky"
            label="Completion Rate"
            value={`${totalSessions ? Math.round((completedCount / totalSessions) * 100) : 0}%`}
            sub={`${completedCount} of ${totalSessions || 0} completed`}
          />
        </div>

        {/* Analytics Row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Top Performer */}
          <Card className="rounded-2xl border-0 overflow-hidden text-white relative bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 shadow-lg shadow-indigo-500/20">
            <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-fuchsia-400/20 blur-2xl" />
            <CardHeader className="pb-2 relative z-10">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-white/70">
                  Top Performer
                </p>
                <div className="rounded-full bg-amber-400/20 p-1.5 ring-1 ring-amber-300/40">
                  <Crown className="h-4 w-4 text-amber-200" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10 space-y-4">
              {topPerformer ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-white/15 ring-2 ring-white/30 flex items-center justify-center text-base font-bold">
                      {initialsOf(topPerformer.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-bold leading-tight truncate">{topPerformer.name}</p>
                      <p className="text-xs text-white/70">Leading this period</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white/10 backdrop-blur px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-white/60">Revenue</p>
                      <p className="text-lg font-bold flex items-center">
                        <IndianRupee className="h-4 w-4" />{topPerformer.revenue.toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/10 backdrop-blur px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-white/60">Clients</p>
                      <p className="text-lg font-bold">{topPerformer.clients}</p>
                    </div>
                  </div>
                  {topThree.length > 0 && (
                    <div className="flex items-end gap-1.5 h-8 pt-1">
                      {topThree.map((t, i) => {
                        const pct = topRevenue ? Math.max(8, (t.revenue / topRevenue) * 100) : 8;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div
                              className="w-full rounded-t-md bg-white/70"
                              style={{ height: `${pct}%`, opacity: 1 - i * 0.25 }}
                              aria-label={`${t.name} revenue share`}
                            />
                            <span className="text-[9px] text-white/60 font-medium">#{i + 1}</span>
                          </div>
                        );
                      })}
                      {Array.from({ length: Math.max(0, 3 - topThree.length) }).map((_, i) => (
                        <div key={`pad-${i}`} className="flex-1 h-2 rounded-t-md bg-white/10" />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center mb-3">
                    <Crown className="h-5 w-5 text-white/70" />
                  </div>
                  <p className="text-sm font-medium text-white">No active packages yet</p>
                  <p className="text-xs text-white/60 mt-1">Sell your first package to crown a top performer.</p>
                  {canManage && (
                    <button
                      onClick={() => setIsCreatePackageOpen(true)}
                      className="mt-3 text-xs font-semibold text-white underline-offset-2 hover:underline cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40 rounded"
                    >
                      Create your first package →
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Package Type Split */}
          <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Package Type Split</CardTitle>
              <p className="text-xs text-slate-500">How your active members are distributed.</p>
            </CardHeader>
            <CardContent>
              {typeTotal > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="relative h-32 w-32 flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={packageTypeSplit.filter(d => d.value > 0)}
                          cx="50%" cy="50%"
                          innerRadius={42} outerRadius={58}
                          paddingAngle={3}
                          dataKey="value"
                          stroke="none"
                        >
                          {packageTypeSplit.filter(d => d.value > 0).map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-bold text-slate-900 leading-none">{typeTotal}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">Active</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3 min-w-0">
                    {packageTypeSplit.map((d) => {
                      const pct = typeTotal ? Math.round((d.value / typeTotal) * 100) : 0;
                      return (
                        <div key={d.name} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                              <span className="font-medium text-slate-700 truncate">{d.name}</span>
                            </div>
                            <span className="font-semibold text-slate-900 tabular-nums">{d.value} · {pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyMini icon={<Package className="h-5 w-5" />} title="No packages yet" hint="Active packages will appear here." />
              )}
            </CardContent>
          </Card>

          {/* Revenue by Trainer */}
          <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-200">
            <CardHeader className="pb-2 flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-slate-900">Revenue by Trainer</CardTitle>
                <p className="text-xs text-slate-500">Top earners this period.</p>
              </div>
              {totalRevenue > 0 && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Total</p>
                  <p className="text-sm font-bold text-slate-900">{formatINR(totalRevenue)}</p>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {trainerRevenue.length > 0 ? (
                <ul className="space-y-3">
                  {trainerRevenue.slice(0, 5).map((t, i) => {
                    const pct = topRevenue ? Math.max(4, (t.revenue / topRevenue) * 100) : 0;
                    const rankStyles = i === 0
                      ? 'bg-amber-100 text-amber-700'
                      : i === 1
                        ? 'bg-slate-200 text-slate-700'
                        : i === 2
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-slate-100 text-slate-500';
                    return (
                      <li key={`${t.name}-${i}`} className="flex items-center gap-3">
                        <span className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0', rankStyles)}>
                          {i + 1}
                        </span>
                        <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', avatarColor(t.name))}>
                          {initialsOf(t.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                            <p className="text-sm font-bold text-slate-900 tabular-nums flex-shrink-0">
                              {formatINR(t.revenue)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 font-medium flex-shrink-0">
                              {t.clients} client{t.clients === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyMini icon={<TrendingUp className="h-5 w-5" />} title="No revenue yet" hint="Revenue will appear once packages are sold." />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Session Status Strip */}
        {totalSessions > 0 && (
          <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50">
            <CardContent className="py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Session Status</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill color="emerald" label="Completed" count={completedCount} />
                    <StatusPill color="indigo" label="Scheduled" count={scheduledCount} />
                    <StatusPill color="rose" label="Cancelled" count={cancelledCount} />
                  </div>
                </div>
                <div className="flex h-2 w-full md:w-72 overflow-hidden rounded-full bg-slate-100">
                  <div className="bg-emerald-500" style={{ width: `${(completedCount / totalSessions) * 100}%` }} />
                  <div className="bg-indigo-500" style={{ width: `${(scheduledCount / totalSessions) * 100}%` }} />
                  <div className="bg-rose-500" style={{ width: `${(cancelledCount / totalSessions) * 100}%` }} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="packages" className="space-y-4">
          <TabsList className="rounded-xl bg-slate-100/80 p-1">
            <TabsTrigger value="packages" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Packages</TabsTrigger>
            <TabsTrigger value="active" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Active Packages</TabsTrigger>
            <TabsTrigger value="sessions" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Sessions</TabsTrigger>
          </TabsList>

          <TabsContent value="packages" className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3">
                <Switch checked={showInactive} onCheckedChange={setShowInactive} id="show-inactive" />
                <Label htmlFor="show-inactive" className="text-sm cursor-pointer flex items-center gap-1.5 text-slate-700">
                  {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  Show Inactive
                </Label>
              </div>
              <span className="text-xs text-slate-500 hidden sm:inline">
                {filteredPackages.length} package{filteredPackages.length === 1 ? '' : 's'}
              </span>
            </div>

            <AddPTPackageDrawer open={isCreatePackageOpen} onOpenChange={setIsCreatePackageOpen} branchId={branchId} />
            <EditPTPackageDrawer open={isEditPackageOpen} onOpenChange={setIsEditPackageOpen} package={editingPackage} />

            {packagesLoading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 animate-pulse overflow-hidden">
                    <div className="h-1.5 bg-slate-200" />
                    <CardHeader>
                      <div className="h-4 bg-slate-200 rounded w-24" />
                      <div className="h-6 bg-slate-200 rounded w-40 mt-2" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-full" />
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredPackages.length === 0 ? (
              <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50">
                <CardContent className="py-16 flex flex-col items-center text-center">
                  <div className="h-14 w-14 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
                    <Package className="h-6 w-6 text-indigo-600" />
                  </div>
                  <p className="text-base font-semibold text-slate-900">
                    {showInactive ? "No PT packages yet" : "No active PT packages"}
                  </p>
                  <p className="text-sm text-slate-500 mt-1 max-w-xs">
                    {showInactive
                      ? "Create your first coaching package to get started."
                      : "Create your first package, or toggle 'Show Inactive' to see archived ones."}
                  </p>
                  {canManage && (
                    <Button
                      onClick={() => setIsCreatePackageOpen(true)}
                      className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20"
                    >
                      <Plus className="mr-2 h-4 w-4" /> Create Package
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

          <TabsContent value="active" className="space-y-4">
            <div className="flex justify-end">
              <Button
                onClick={() => setIsScheduleOpen(true)}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20"
              >
                <Calendar className="mr-2 h-4 w-4" /> Schedule Session
              </Button>
            </div>

            <Sheet open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Schedule PT Session</SheetTitle>
                  <SheetDescription>Book a personal training session</SheetDescription>
                </SheetHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Member Package *</Label>
                    <Select value={selectedPackageForSession} onValueChange={setSelectedPackageForSession}>
                      <SelectTrigger><SelectValue placeholder="Select member package" /></SelectTrigger>
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
                    <Label>Date & Time *</Label>
                    <Input type="datetime-local" value={newSession.scheduled_at} onChange={(e) => setNewSession({ ...newSession, scheduled_at: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration (minutes)</Label>
                    <Input type="number" value={newSession.duration_minutes} onChange={(e) => setNewSession({ ...newSession, duration_minutes: parseInt(e.target.value) || 60 })} />
                  </div>
                </div>
                <SheetFooter>
                  <Button variant="outline" onClick={() => setIsScheduleOpen(false)}>Cancel</Button>
                  <Button onClick={handleScheduleSession} disabled={scheduleSession.isPending}>
                    {scheduleSession.isPending ? "Scheduling..." : "Schedule"}
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            {activePackages?.length === 0 ? (
              <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50">
                <CardContent className="py-16 flex flex-col items-center text-center">
                  <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                    <Users className="h-6 w-6 text-emerald-600" />
                  </div>
                  <p className="text-base font-semibold text-slate-900">No active PT packages</p>
                  <p className="text-sm text-slate-500 mt-1 max-w-xs">
                    Once members purchase a package it will appear here for scheduling.
                  </p>
                  <Button onClick={() => setIsScheduleOpen(true)} className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
                    <Calendar className="mr-2 h-4 w-4" /> Schedule Session
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead>Member</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead>Trainer</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePackages?.map((pkg) => (
                      <TableRow key={pkg.id} className="hover:bg-slate-50 transition-colors duration-150">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold', avatarColor(pkg.member_name))}>
                              {initialsOf(pkg.member_name)}
                            </div>
                            <span className="font-medium text-slate-900">{pkg.member_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-700">{pkg.package_name}</TableCell>
                        <TableCell className="text-slate-700">{pkg.trainer_name || "—"}</TableCell>
                        <TableCell>
                          {(() => {
                            if (pkg.sessions_total > 0) {
                              const used = pkg.sessions_total - pkg.sessions_remaining;
                              const pct = Math.round((used / pkg.sessions_total) * 100);
                              return (
                                <div className="space-y-1 min-w-[130px]">
                                  <Progress value={pct} className={`h-2 ${pct >= 90 ? '[&>div]:bg-destructive' : pct >= 75 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`} />
                                  <p className="text-xs text-slate-500">{used}/{pkg.sessions_total} sessions</p>
                                </div>
                              );
                            }
                            const start = new Date(pkg.start_date || pkg.created_at);
                            const end = new Date(pkg.expiry_date);
                            const totalDays = Math.max(1, differenceInDays(end, start));
                            const elapsed = Math.max(0, differenceInDays(new Date(), start));
                            const pct = Math.min(100, Math.round((elapsed / totalDays) * 100));
                            const daysLeft = Math.max(0, differenceInDays(end, new Date()));
                            return (
                              <div className="space-y-1 min-w-[150px]">
                                <Progress value={pct} className={`h-2 ${pct >= 90 ? '[&>div]:bg-destructive' : pct >= 75 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`} />
                                <p className="text-xs text-slate-500">{elapsed}d / {totalDays}d · {daysLeft}d left</p>
                                <p className="text-[10px] text-slate-400">{format(start, "MMM d")} → {format(end, "MMM d")}</p>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-slate-700">{format(new Date(pkg.expiry_date), "PP")}</TableCell>
                        <TableCell>
                          <Badge variant={pkg.status === "active" ? "default" : "secondary"} className="rounded-full">
                            {pkg.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4">
            {sessions?.length === 0 ? (
              <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50">
                <CardContent className="py-16 flex flex-col items-center text-center">
                  <div className="h-14 w-14 rounded-full bg-amber-50 flex items-center justify-center mb-4">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                  <p className="text-base font-semibold text-slate-900">No upcoming sessions</p>
                  <p className="text-sm text-slate-500 mt-1 max-w-xs">Sessions you schedule will appear here.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions?.map((session) => (
                      <TableRow key={session.id} className="hover:bg-slate-50 transition-colors duration-150">
                        <TableCell className="font-medium text-slate-900">{format(new Date(session.scheduled_at), "PPP p")}</TableCell>
                        <TableCell className="text-slate-700">{session.member_name}</TableCell>
                        <TableCell className="text-slate-700">{session.duration_minutes} min</TableCell>
                        <TableCell>
                          <Badge
                            variant={session.status === "completed" ? "default" : session.status === "cancelled" ? "destructive" : "secondary"}
                            className="rounded-full"
                          >
                            {session.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {session.status === "scheduled" && (
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Mark session complete"
                                className="h-9 w-9 rounded-lg hover:bg-emerald-50 text-emerald-600 cursor-pointer"
                                onClick={() => handleCompleteSession(session.id)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Cancel session"
                                className="h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"
                                onClick={() => handleCancelSession(session.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
      </TooltipProvider>
    </AppLayout>
  );
}

/* ───────────────── helpers ───────────────── */

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
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600',
  } as const;
  return (
    <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-200">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div className={cn('h-10 w-10 rounded-full flex items-center justify-center', tintMap[tint])}>
            {icon}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">{value}</p>
          <p className="text-xs text-slate-500 mt-1">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ color, label, count }: { color: 'emerald' | 'indigo' | 'rose'; label: string; count: number }) {
  const map = {
    emerald: 'bg-emerald-50 text-emerald-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    rose: 'bg-rose-50 text-rose-700',
  } as const;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', map[color])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', color === 'emerald' ? 'bg-emerald-500' : color === 'indigo' ? 'bg-indigo-500' : 'bg-rose-500')} />
      {label} <span className="font-bold tabular-nums">{count}</span>
    </span>
  );
}

function EmptyMini({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 mb-2">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-0.5 max-w-[200px]">{hint}</p>
    </div>
  );
}

function PackageCard({
  pkg, canManage, onEdit, onToggle,
}: {
  pkg: any;
  canManage: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const tier = inferTier(pkg.name);
  const isMonthly = pkg.session_type === 'monthly' || pkg.session_type === 'quarterly' || (pkg.total_sessions ?? 0) === 0;
  const inactive = pkg.is_active === false;
  const months = Math.max(1, Math.round((pkg.validity_days || 30) / 30));
  const badgeLabel = isMonthly
    ? (pkg.session_type === 'quarterly' ? 'Quarterly' : 'Monthly Plan')
    : (SESSION_TYPES.find((t) => t.value === pkg.session_type)?.label || 'Per Session');

  return (
    <Card
      className={cn(
        'rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-200 overflow-hidden relative group',
        inactive && 'opacity-70',
      )}
    >
      <div className={cn('h-1.5', TIER_RIBBON[tier])} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TIER_ICON_BG[tier])}>
            {isMonthly ? <CalendarDays className="h-3 w-3" /> : <Dumbbell className="h-3 w-3" />}
            {badgeLabel}
          </span>
          {canManage && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 md:transition-opacity max-md:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit package"
                className="h-8 w-8 rounded-lg hover:bg-indigo-50 text-indigo-600 cursor-pointer"
                onClick={onEdit}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={inactive ? 'Activate package' : 'Deactivate package'}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                onClick={onToggle}
              >
                {inactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0', TIER_ICON_BG[tier])}>
            <Package className="h-4 w-4" />
          </div>
          <CardTitle className="text-lg font-bold text-slate-900 leading-snug">{pkg.name}</CardTitle>
        </div>
        {inactive && (
          <Badge className="absolute top-3 right-3 rounded-full bg-slate-200 text-slate-700 text-[10px] hover:bg-slate-200">
            Inactive
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {pkg.description && (
          <UITooltip>
            <TooltipTrigger asChild>
              <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 cursor-help">
                {pkg.description}
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs leading-relaxed">{pkg.description}</p>
            </TooltipContent>
          </UITooltip>
        )}

        <div className="grid grid-cols-3 divide-x divide-slate-100 rounded-xl bg-slate-50/60 py-3">
          <div className="text-center px-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {isMonthly ? 'Months' : 'Sessions'}
            </p>
            <p className="text-base font-bold text-slate-900 mt-0.5 tabular-nums">
              {isMonthly ? months : (pkg.total_sessions || 0)}
            </p>
          </div>
          <div className="text-center px-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Price</p>
            <p className="text-base font-bold text-slate-900 mt-0.5 flex items-center justify-center tabular-nums">
              <IndianRupee className="h-3.5 w-3.5" />{(pkg.price || 0).toLocaleString('en-IN')}
            </p>
          </div>
          <div className="text-center px-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Validity</p>
            <p className="text-base font-bold text-slate-900 mt-0.5 tabular-nums">{pkg.validity_days || 0}d</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
