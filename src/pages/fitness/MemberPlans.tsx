import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Library,
  Users,
  Search,
  Eye,
  Dumbbell,
  Utensils,
  CalendarClock,
  AlarmClock,
  Activity,
  MoreVertical,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { FitnessHubTabs } from "@/components/fitness/FitnessHubTabs";
import { format, differenceInDays, parseISO } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  fetchMemberAssignments,
  revokeMemberAssignment,
  type MemberAssignmentRow,
} from "@/services/fitnessService";
import { useBranchContext } from "@/contexts/BranchContext";
import { PlanViewerSheet } from "@/components/fitness/PlanViewerSheet";
import { SendPlanPdfMenu } from "@/components/fitness/SendPlanPdfMenu";
import { sendPlanToMember } from "@/utils/sendPlanToMember";

type StatusFilter = "active" | "expired" | "all";
type TabKey = "all" | "workout" | "diet";

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow/40">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-11 w-11 rounded-2xl flex items-center justify-center ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface MemberGroup {
  member_id: string;
  member_name: string;
  member_code: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  branch_id: string | null;
  workout: MemberAssignmentRow[];
  diet: MemberAssignmentRow[];
}

export default function FitnessMemberPlansPage() {
  const navigate = useNavigate();
  const { effectiveBranchId: activeBranchId } = useBranchContext();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [tab, setTab] = useState<TabKey>("all");
  const [viewing, setViewing] = useState<MemberAssignmentRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<MemberAssignmentRow | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["fitness-member-assignments", activeBranchId],
    queryFn: () => fetchMemberAssignments(activeBranchId),
  });

  // Apply status + search before grouping
  const filteredFlat = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter((a) => {
      if (statusFilter === "active" && a.is_expired) return false;
      if (statusFilter === "expired" && !a.is_expired) return false;
      if (!q) return true;
      return (
        a.member_name.toLowerCase().includes(q) ||
        a.plan_name.toLowerCase().includes(q) ||
        (a.member_code || "").toLowerCase().includes(q) ||
        (a.trainer_name || "").toLowerCase().includes(q)
      );
    });
  }, [assignments, search, statusFilter]);

  // Group by member
  const grouped: MemberGroup[] = useMemo(() => {
    const map = new Map<string, MemberGroup>();
    for (const a of filteredFlat) {
      let g = map.get(a.member_id);
      if (!g) {
        g = {
          member_id: a.member_id,
          member_name: a.member_name,
          member_code: a.member_code,
          avatar_url: a.avatar_url,
          phone: a.phone,
          email: a.email,
          branch_id: a.branch_id,
          workout: [],
          diet: [],
        };
        map.set(a.member_id, g);
      }
      if (a.plan_type === "workout") g.workout.push(a);
      else if (a.plan_type === "diet") g.diet.push(a);
    }
    return Array.from(map.values()).sort((x, y) =>
      x.member_name.localeCompare(y.member_name),
    );
  }, [filteredFlat]);

  // Tab filter (after grouping so cards stay grouped per member)
  const visibleGroups = useMemo(() => {
    if (tab === "all") return grouped;
    return grouped.filter((g) =>
      tab === "workout" ? g.workout.length > 0 : g.diet.length > 0,
    );
  }, [grouped, tab]);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = assignments.filter((a) => !a.is_expired);
    const workouts = active.filter((a) => a.plan_type === "workout").length;
    const diets = active.filter((a) => a.plan_type === "diet").length;
    const expiring = active.filter(
      (a) =>
        a.valid_until &&
        a.valid_until >= today &&
        differenceInDays(parseISO(a.valid_until), new Date()) <= 7,
    ).length;
    const uniqueMembers = new Set(active.map((a) => a.member_id)).size;
    return { workouts, diets, expiring, uniqueMembers };
  }, [assignments]);

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeMemberAssignment(id),
    onSuccess: () => {
      toast.success("Plan revoked");
      queryClient.invalidateQueries({ queryKey: ["fitness-member-assignments"] });
      setRevokeTarget(null);
    },
    onError: (e: any) => toast.error(e?.message || "Failed to revoke"),
  });

  const renderStatusChip = (a: MemberAssignmentRow) => {
    if (a.is_expired) return <Badge variant="secondary" className="text-[10px]">Expired</Badge>;
    if (!a.valid_until) return <Badge className="bg-success/15 text-success border-success/20 text-[10px]">Active</Badge>;
    const days = differenceInDays(parseISO(a.valid_until), new Date());
    if (days <= 7) return <Badge className="bg-warning/15 text-warning border-warning/20 text-[10px]">{days}d left</Badge>;
    return <Badge className="bg-success/15 text-success border-success/20 text-[10px]">{days}d left</Badge>;
  };

  const toggleMember = (id: string) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const renderPlanRow = (a: MemberAssignmentRow) => {
    const Icon = a.plan_type === "workout" ? Dumbbell : Utensils;
    const accent = a.plan_type === "workout" ? "text-primary bg-primary/10" : "text-success bg-success/10";
    return (
      <div
        key={a.id}
        className="flex items-center gap-3 rounded-xl border border-border/50 bg-background hover:bg-muted/30 transition p-3"
      >
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{a.plan_name}</p>
            {renderStatusChip(a)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
            {a.trainer_name && <span>by {a.trainer_name}</span>}
            {a.template_name && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <Badge variant="outline" className="text-[10px] py-0 h-4">
                  {a.template_name}
                </Badge>
              </>
            )}
            {(a.valid_from || a.valid_until) && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {a.valid_from ? format(parseISO(a.valid_from), "dd MMM") : "—"}
                  {" → "}
                  {a.valid_until ? format(parseISO(a.valid_until), "dd MMM yyyy") : "ongoing"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setViewing(a)}>
            <Eye className="h-3.5 w-3.5" /> View
          </Button>
          <SendPlanPdfMenu
            member={{
              id: a.member_id,
              full_name: a.member_name,
              phone: a.phone,
              email: a.email,
            }}
            plan={{
              name: a.plan_name,
              type: a.plan_type,
              description: a.description,
              data: a.plan_data,
              valid_from: a.valid_from,
              valid_until: a.valid_until,
              trainer_name: a.trainer_name,
            }}
            branchId={a.branch_id || activeBranchId}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate(`/fitness/templates`)}>
                <RefreshCw className="h-4 w-4 mr-2" /> Reassign / Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setRevokeTarget(a)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Revoke plan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />

        {/* KPI strip */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={Dumbbell} label="Active workout plans" value={kpis.workouts} accent="bg-primary/10 text-primary" />
          <KpiCard icon={Utensils} label="Active diet plans" value={kpis.diets} accent="bg-success/10 text-success" />
          <KpiCard icon={AlarmClock} label="Expiring in 7 days" value={kpis.expiring} accent="bg-warning/10 text-warning" />
          <KpiCard icon={Users} label="Members on a plan" value={kpis.uniqueMembers} accent="bg-accent/10 text-accent" />
        </div>

        {/* Header + search */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Member Plans
            </h2>
            <p className="text-sm text-muted-foreground">
              Plans grouped by member — switch tabs for Workout or Diet only
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search member, plan, trainer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
            <Button onClick={() => navigate("/fitness/templates")} variant="outline" className="gap-1.5">
              <Library className="h-4 w-4" /> Templates
            </Button>
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          {(["active", "expired", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border"
              }`}
            >
              {s === "active" ? "Active" : s === "expired" ? "Expired" : "All"}
            </button>
          ))}
        </div>

        {/* Tabs: All / Workout / Diet */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="rounded-xl">
            <TabsTrigger value="all" className="rounded-lg">All</TabsTrigger>
            <TabsTrigger value="workout" className="rounded-lg gap-1.5">
              <Dumbbell className="h-3.5 w-3.5" /> Workout
            </TabsTrigger>
            <TabsTrigger value="diet" className="rounded-lg gap-1.5">
              <Utensils className="h-3.5 w-3.5" /> Diet
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : visibleGroups.length === 0 ? (
              <Card className="rounded-2xl border-0 shadow-lg shadow/40">
                <CardContent className="py-16 text-center">
                  <div className="h-14 w-14 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
                    <Users className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-1">
                    {assignments.length === 0
                      ? "No member plans assigned yet"
                      : "No plans match your filters"}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    {assignments.length === 0
                      ? "Assign plans to members from the Template Library or build a new one."
                      : "Adjust the search or filters above to see more results."}
                  </p>
                  <Button onClick={() => navigate("/fitness/templates")}>
                    <Library className="mr-2 h-4 w-4" /> Browse Templates
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {visibleGroups.map((g) => {
                  const isOpen = expanded[g.member_id] ?? true;
                  const showWorkout = tab !== "diet" && g.workout.length > 0;
                  const showDiet = tab !== "workout" && g.diet.length > 0;
                  return (
                    <Card
                      key={g.member_id}
                      className="rounded-2xl border-0 shadow-lg shadow/40"
                    >
                      <CardContent className="p-4 space-y-3">
                        <button
                          onClick={() => toggleMember(g.member_id)}
                          className="w-full flex items-center gap-3"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
                          )}
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={g.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                              {g.member_name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-semibold truncate">{g.member_name}</p>
                            <p className="text-xs text-muted-foreground">{g.member_code || "—"}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {g.workout.length > 0 && (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Dumbbell className="h-3 w-3" /> {g.workout.length}
                              </Badge>
                            )}
                            {g.diet.length > 0 && (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Utensils className="h-3 w-3" /> {g.diet.length}
                              </Badge>
                            )}
                          </div>
                        </button>

                        {isOpen && (
                          <div className="pl-7 space-y-2">
                            {showWorkout && (
                              <div className="space-y-2">
                                {tab === "all" && (
                                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                    Workout
                                  </p>
                                )}
                                {g.workout.map(renderPlanRow)}
                              </div>
                            )}
                            {showDiet && (
                              <div className="space-y-2">
                                {tab === "all" && (
                                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                    Diet
                                  </p>
                                )}
                                {g.diet.map(renderPlanRow)}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <PlanViewerSheet
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        plan={
          viewing
            ? {
                id: viewing.id,
                name: viewing.plan_name,
                type: viewing.plan_type,
                description: viewing.description,
                data: viewing.plan_data,
                member_name: viewing.member_name,
                trainer_name: viewing.trainer_name,
                valid_from: viewing.valid_from,
                valid_until: viewing.valid_until,
                template_name: viewing.template_name,
              }
            : null
        }
        onDownload={() => {
          if (!viewing) return;
          sendPlanToMember({
            member: {
              id: viewing.member_id,
              full_name: viewing.member_name,
              phone: viewing.phone,
              email: viewing.email,
            },
            plan: {
              name: viewing.plan_name,
              type: viewing.plan_type,
              description: viewing.description,
              data: viewing.plan_data,
              valid_from: viewing.valid_from,
              valid_until: viewing.valid_until,
              trainer_name: viewing.trainer_name,
            },
            branchId: viewing.branch_id || activeBranchId,
            channels: ["download"],
          });
        }}
      />

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              The member will lose access to <b>{revokeTarget?.plan_name}</b> from today.
              You can always assign a new plan later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
