import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Users,
  RefreshCw,
  Eye,
  DoorOpen,
  LogOut,
  UserPlus,
  ShieldAlert,
  Copy,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { remoteOpenDoorByBranch } from "@/services/mipsService";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  groupAccessEvents,
  formatOnSite,
  type RawAccessEvent,
  type PersonSession,
} from "@/lib/devices/accessSessions";

interface LiveAccessLogProps {
  branchId?: string;
  /** max raw events pulled for the day window */
  limit?: number;
}

type ReconcileResult = {
  success: boolean;
  fetched: number;
  imported: number;
  skipped: number;
  unmatched: number;
  attendance_updated: number;
  latest_record_at: string | null;
  error?: string;
};

type FilterKey = "inside" | "all" | "members" | "team" | "denied" | "unmatched";

const kindBadge: Record<PersonSession["kind"], { label: string; className: string }> = {
  member: { label: "Member", className: "bg-indigo-100 text-indigo-700" },
  trainer: { label: "Trainer", className: "bg-violet-100 text-violet-700" },
  staff: { label: "Staff", className: "bg-sky-100 text-sky-700" },
  denied: { label: "Denied", className: "bg-red-100 text-red-700" },
  unmatched: { label: "Not in CRM", className: "bg-amber-100 text-amber-700" },
};

function getBillingBadge(memberships: Array<{ status: string; end_date: string }> | undefined) {
  if (!memberships?.length) return null;
  const active = memberships.find((m) => m.status === "active");
  if (!active) {
    const frozen = memberships.find((m) => m.status === "frozen");
    if (frozen)
      return <Badge variant="outline" className="rounded-full text-[10px] bg-blue-50 text-blue-700 border-blue-200">Frozen</Badge>;
    return <Badge variant="outline" className="rounded-full text-[10px] bg-red-50 text-red-700 border-red-200">No active plan</Badge>;
  }
  const daysLeft = differenceInDays(new Date(active.end_date), new Date());
  if (daysLeft < 0)
    return <Badge variant="outline" className="rounded-full text-[10px] bg-red-50 text-red-700 border-red-200">Overdue</Badge>;
  if (daysLeft <= 7)
    return <Badge variant="outline" className="rounded-full text-[10px] bg-amber-50 text-amber-700 border-amber-200">Due in {daysLeft}d</Badge>;
  return <Badge variant="outline" className="rounded-full text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">{daysLeft}d left</Badge>;
}

function istDayStartIso(): string {
  // 00:00 IST of the current IST day, expressed as a UTC instant.
  const istDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(`${istDate}T00:00:00+05:30`).toISOString();
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

const LiveAccessLog = ({ branchId, limit = 400 }: LiveAccessLogProps) => {
  const queryClient = useQueryClient();
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [openingDoor, setOpeningDoor] = useState(false);
  const [lastReconcile, setLastReconcile] = useState<ReconcileResult | null>(null);
  const [filter, setFilter] = useState<FilterKey>("inside");

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<ReconcileResult>("reconcile-mips-pass-records", {
        body: { branch_id: branchId, limit: 100 },
      });
      if (error) throw error;
      if (!data) throw new Error("MIPS reconciliation returned no response");
      if (!data.success && data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setLastReconcile(data);
      queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "MIPS reconciliation failed";
      setLastReconcile(
        (current) =>
          current ?? {
            success: false,
            fetched: 0,
            imported: 0,
            skipped: 0,
            unmatched: 0,
            attendance_updated: 0,
            latest_record_at: null,
            error: message,
          },
      );
    },
  });

  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ["access-logs-live", branchId, limit],
    queryFn: async () => {
      let query = supabase
        .from("access_logs")
        .select(
          `*, members:member_id(id, member_code, biometric_photo_url, profiles:user_id(full_name, avatar_url), memberships(status, end_date, membership_plans(name)))`,
        )
        .gte("created_at", istDayStartIso())
        .order("created_at", { ascending: false })
        .limit(limit);

      if (branchId) query = query.eq("branch_id", branchId);
      const { data, error } = await query;
      if (error) throw error;

      const rows = ((data || []) as unknown as RawAccessEvent[]).map((e) => ({
        ...e,
        source: e.payload?.source === "mips_record_reconcile" ? ("mips" as const) : ("webhook" as const),
      }));

      // Staff/trainer names live on profiles; resolve them in one extra round-trip
      // (no FK alias — see project rules on auto-generated join hints).
      const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))] as string[];
      if (profileIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", profileIds);
        const map = new Map((profiles || []).map((p) => [p.id, p]));
        for (const r of rows) {
          if (r.profile_id && map.has(r.profile_id)) {
            const p = map.get(r.profile_id)!;
            r.profiles = { full_name: p.full_name, avatar_url: p.avatar_url };
          }
        }
      }
      return rows;
    },
  });

  useEffect(() => {
    reconcileMutation.mutate();
    const interval = window.setInterval(() => {
      if (!reconcileMutation.isPending) reconcileMutation.mutate();
    }, 15_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "error">("connecting");
  useEffect(() => {
    const channel = supabase
      .channel("access-logs-realtime-" + (branchId || "all"))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "access_logs",
          ...(branchId ? { filter: `branch_id=eq.${branchId}` } : {}),
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["access-logs-live", branchId, limit] });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("error");
        else setRtStatus("connecting");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId, limit, queryClient]);

  const grouped = useMemo(() => groupAccessEvents(events), [events]);

  const counts = useMemo(
    () => ({
      inside: grouped.people.filter((p) => p.isInside).length,
      all: grouped.people.length + grouped.unmatched.length,
      members: grouped.people.filter((p) => p.kind === "member").length,
      team: grouped.people.filter((p) => p.kind === "staff" || p.kind === "trainer").length,
      denied: grouped.people.filter((p) => p.denied).length,
      unmatched: grouped.unmatched.length,
    }),
    [grouped],
  );

  const visible = useMemo(() => {
    const all = [...grouped.people, ...grouped.unmatched];
    switch (filter) {
      case "inside":
        return grouped.people.filter((p) => p.isInside);
      case "members":
        return grouped.people.filter((p) => p.kind === "member");
      case "team":
        return grouped.people.filter((p) => p.kind === "staff" || p.kind === "trainer");
      case "denied":
        return grouped.people.filter((p) => p.denied);
      case "unmatched":
        return grouped.unmatched;
      default:
        return all;
    }
  }, [grouped, filter]);

  const mipsError = reconcileMutation.isError || lastReconcile?.success === false;
  const mipsStatusText = reconcileMutation.isPending
    ? "MIPS syncing"
    : mipsError
      ? "MIPS unreachable"
      : `MIPS · ${lastReconcile?.fetched ?? 0}`;

  const handleManualOverride = async () => {
    if (!branchId) {
      toast.error("No branch selected");
      return;
    }
    setOpeningDoor(true);
    try {
      const result = await remoteOpenDoorByBranch(branchId);
      if (result.success) toast.success("Door opened!");
      else toast.error(result.message);
    } finally {
      setOpeningDoor(false);
    }
  };

  const checkOutMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await supabase.rpc("member_check_out", { _member_id: memberId });
      if (error) throw error;
      return data as { success?: boolean; duration_minutes?: number; message?: string };
    },
    onSuccess: (data) => {
      if (data?.success) {
        toast.success(`Checked out — ${Math.round(data.duration_minutes || 0)} min session`);
        queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
      } else {
        toast.info(data?.message || "No active check-in found");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const staffCheckOutMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing, error: fetchErr } = await (supabase.from("staff_attendance") as any)
        .select("id, check_out")
        .eq("user_id", profileId)
        .eq("date", today)
        .is("check_out", null)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) throw new Error("No active check-in found");
      const { error: updateErr } = await supabase
        .from("staff_attendance")
        .update({ check_out: new Date().toISOString() })
        .eq("id", existing.id);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      toast.success("Staff checked out");
      queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const insidePeople = grouped.people.filter((p) => p.isInside);

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "inside", label: "In gym now", count: counts.inside },
    { key: "all", label: "Everyone today", count: counts.all },
    { key: "members", label: "Members", count: counts.members },
    { key: "team", label: "Staff & trainers", count: counts.team },
    { key: "denied", label: "Denied", count: counts.denied },
    { key: "unmatched", label: "Not in CRM", count: counts.unmatched },
  ];

  return (
    <Card className="rounded-2xl border-border/60 shadow-lg shadow-slate-200/40 dark:shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Access Presence</CardTitle>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                rtStatus === "live"
                  ? "bg-emerald-100 text-emerald-700"
                  : rtStatus === "error"
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600",
              )}
              title={`Realtime: ${rtStatus}`}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  rtStatus === "live" ? "bg-emerald-500 animate-pulse" : rtStatus === "error" ? "bg-red-500" : "bg-slate-400",
                )}
              />
              {rtStatus === "live" ? "Live" : rtStatus === "error" ? "Offline" : "Connecting"}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                mipsError ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700",
              )}
              title={
                mipsError
                  ? lastReconcile?.error || "MIPS server unreachable — showing stored events only"
                  : `Backend imports MIPS records every 15s; imported ${lastReconcile?.imported ?? 0}, skipped ${lastReconcile?.skipped ?? 0}`
              }
            >
              {mipsStatusText}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {branchId && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl text-xs"
                onClick={handleManualOverride}
                disabled={openingDoor}
              >
                <DoorOpen className="h-3.5 w-3.5" />
                {openingDoor ? "Opening…" : "Override"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl"
              onClick={() => {
                reconcileMutation.mutate();
                queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
              }}
              disabled={reconcileMutation.isPending}
              aria-label="Refresh access presence"
            >
              <RefreshCw className={cn("h-4 w-4", reconcileMutation.isPending && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* In-gym-now strip */}
        <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/15 p-2">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{counts.inside}</p>
                <p className="mt-1 text-xs text-white/80">In the gym now · {counts.all} people today</p>
              </div>
            </div>
            <div className="flex -space-x-2">
              {insidePeople.slice(0, 8).map((p) => (
                <Avatar key={p.key} className="h-8 w-8 ring-2 ring-white/70" title={p.name}>
                  {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="bg-white/20 text-[10px] font-semibold text-white">
                    {initials(p.name)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {insidePeople.length > 8 && (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold ring-2 ring-white/70">
                  +{insidePeople.length - 8}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500",
                filter === f.key
                  ? "bg-indigo-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className={cn("ml-1.5 tabular-nums", filter === f.key ? "text-white/80" : "text-foreground/60")}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        <ScrollArea className="h-[420px] pr-2">
          {isLoading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ShieldAlert className="mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm">Could not load access events</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm">
                {filter === "inside" ? "Nobody is in the gym right now" : "No access activity in this view"}
              </p>
              <p className="mt-1 text-xs">Scans consolidate here per person, in real time</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visible.map((p) => {
                const badge = kindBadge[p.denied && p.kind === "member" ? "denied" : p.kind];
                const expanded = expandedPerson === p.key;
                return (
                  <div
                    key={p.key}
                    className={cn(
                      "rounded-2xl bg-muted/40 p-3 transition-all duration-200 hover:bg-muted/70",
                      p.isInside && "ring-1 ring-emerald-300/70",
                      p.denied && "ring-1 ring-red-300/70",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 ring-1 ring-border">
                          {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                          <AvatarFallback className="bg-background text-xs font-semibold">
                            {initials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                        {p.isInside && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{p.name}</span>
                          {p.code && (
                            <span className="font-mono text-[10px] text-muted-foreground">{p.code}</span>
                          )}
                          <Badge className={cn("rounded-full px-2 py-0 text-[10px] font-medium hover:bg-inherit", badge.className)}>
                            {badge.label}
                          </Badge>
                          {getBillingBadge(p.memberships)}
                          {p.isInside && (
                            <Badge className="rounded-full bg-emerald-100 px-2 py-0 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">
                              In gym
                            </Badge>
                          )}
                        </div>

                        {/* Punch trail */}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.punches.map((punch) => (
                            <span
                              key={punch.id}
                              title={`${punch.gate} · ${punch.message ?? ""}`}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium",
                                punch.result === "member_denied" || punch.result === "stranger" || punch.result === "not_found"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-background text-slate-600 dark:text-foreground",
                              )}
                            >
                              <Clock className="h-2.5 w-2.5" />
                              {format(new Date(punch.at), "HH:mm")}
                              <span className="text-muted-foreground">· {punch.gate}</span>
                              {punch.count > 1 && <span className="text-muted-foreground">×{punch.count}</span>}
                            </span>
                          ))}
                        </div>

                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          First {format(new Date(p.firstAt), "HH:mm")} · Last{" "}
                          {formatDistanceToNow(new Date(p.lastAt), { addSuffix: true })} ·{" "}
                          {formatOnSite(p.onSiteMinutes)} on site · {p.scanCount} scan{p.scanCount === 1 ? "" : "s"}
                        </p>

                        {p.denied && p.notes[0] && (
                          <p className="mt-1 text-[11px] font-medium text-red-600">{p.notes[0]}</p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {p.denied && branchId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[10px] text-amber-600 hover:text-amber-700"
                              onClick={handleManualOverride}
                              disabled={openingDoor}
                            >
                              <DoorOpen className="h-3 w-3" />
                              Override door
                            </Button>
                          )}
                          {p.kind === "member" && p.memberId && p.isInside && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => checkOutMutation.mutate(p.memberId!)}
                              disabled={checkOutMutation.isPending}
                            >
                              <LogOut className="h-3 w-3" />
                              Check out
                            </Button>
                          )}
                          {(p.kind === "staff" || p.kind === "trainer") && p.profileId && p.isInside && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => staffCheckOutMutation.mutate(p.profileId!)}
                              disabled={staffCheckOutMutation.isPending}
                            >
                              <LogOut className="h-3 w-3" />
                              Check out
                            </Button>
                          )}
                          {p.kind === "unmatched" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[10px] text-amber-700 hover:text-amber-800"
                              onClick={() => {
                                if (p.code) {
                                  navigator.clipboard?.writeText(p.code);
                                  toast.success(`Copied ${p.code} — link it in Personnel Sync`);
                                } else {
                                  toast.info("No MIPS person code on this record");
                                }
                              }}
                            >
                              <UserPlus className="h-3 w-3" />
                              Link in CRM
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}

                          <Collapsible open={expanded} onOpenChange={(o) => setExpandedPerson(o ? p.key : null)}>
                            <CollapsibleTrigger asChild>
                              <button className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                                <Eye className="h-3 w-3" />
                                {expanded ? "Hide" : "Raw"} payload
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <pre className="mt-1 max-h-40 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-background p-2 text-[10px]">
                                {JSON.stringify(p.punches[p.punches.length - 1]?.payload ?? {}, null, 2)}
                              </pre>
                            </CollapsibleContent>
                          </Collapsible>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* CRM-side hardware actions, kept out of the human traffic feed */}
        {grouped.systemActions.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  CRM hardware actions today
                </span>
                <span className="tabular-nums">{grouped.systemActions.length}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 space-y-1.5">
                {grouped.systemActions.slice(0, 20).map((a) => (
                  <li key={a.id} className="flex items-start gap-2 rounded-lg px-2 py-1 text-[11px]">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        a.eventType === "hardware_restore" ? "bg-emerald-500" : "bg-red-500",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.message}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatDistanceToNow(new Date(a.at), { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
};

export default LiveAccessLog;
