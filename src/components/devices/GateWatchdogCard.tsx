import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface HealthEvent {
  id: string;
  device_name: string | null;
  serial_number: string | null;
  event_type: "offline" | "recovered" | "restart_suspected" | "watchdog_error";
  detected_at: string;
  offline_seconds: number | null;
  dispatches_before: number | null;
}

const EVENT_META: Record<
  HealthEvent["event_type"],
  { label: string; badge: string; icon: typeof Activity }
> = {
  restart_suspected: {
    label: "Restarted",
    badge: "bg-red-100 text-red-700",
    icon: AlertTriangle,
  },
  offline: { label: "Went offline", badge: "bg-amber-100 text-amber-700", icon: PlugZap },
  recovered: { label: "Back online", badge: "bg-emerald-100 text-emerald-700", icon: ShieldCheck },
  watchdog_error: { label: "Watchdog error", badge: "bg-slate-100 text-slate-600", icon: Activity },
};

const GateWatchdogCard = ({ branchId }: { branchId?: string }) => {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ["gate-watchdog-events", branchId],
    queryFn: async (): Promise<HealthEvent[]> => {
      let q = supabase
        .from("access_device_health_events")
        .select("id, device_name, serial_number, event_type, detected_at, offline_seconds, dispatches_before")
        .order("detected_at", { ascending: false })
        .limit(12);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as HealthEvent[];
    },
    refetchInterval: 60_000,
  });

  const restarts24h = (events || []).filter(
    (e) => e.event_type === "restart_suspected" && Date.now() - Date.parse(e.detected_at) < 864e5,
  ).length;

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-device-watchdog", { body: {} });
      if (error) throw error;
      const r = data as { checked?: number; restarts?: number };
      toast.success(`Checked ${r?.checked ?? 0} gate(s) — ${r?.restarts ?? 0} restart(s) detected`);
      qc.invalidateQueries({ queryKey: ["gate-watchdog-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Watchdog check failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-base">Gate restart watchdog</CardTitle>
            <p className="text-xs text-muted-foreground">
              Checks every 5 minutes and records each time a gate drops or reboots.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              restarts24h > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {restarts24h > 0 ? `${restarts24h} restart(s) in 24h` : "Stable 24h"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] cursor-pointer rounded-xl focus:ring-2 focus:ring-indigo-500"
            onClick={runNow}
            disabled={running}
            aria-label="Run gate watchdog check now"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Checking…" : "Check now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </>
        ) : (events || []).length === 0 ? (
          <div className="rounded-xl bg-emerald-50/60 p-6 text-center">
            <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-emerald-600" />
            <p className="text-sm font-semibold text-slate-900">No gate drops recorded</p>
            <p className="text-xs text-muted-foreground">
              Every offline moment and reboot will appear here the moment it happens.
            </p>
          </div>
        ) : (
          (events || []).map((e) => {
            const meta = EVENT_META[e.event_type] ?? EVENT_META.watchdog_error;
            const Icon = meta.icon;
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 transition-colors duration-150 hover:bg-slate-100"
              >
                <span className="mt-0.5 rounded-full bg-white p-1.5 text-slate-600 shadow-sm">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {e.device_name || e.serial_number || "Gate"}
                    </span>
                    <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}>
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {format(new Date(e.detected_at), "dd MMM, h:mm a")} ·{" "}
                    {formatDistanceToNow(new Date(e.detected_at), { addSuffix: true })}
                    {e.offline_seconds != null && ` · down ${Math.round(e.offline_seconds / 60)} min`}
                    {e.dispatches_before != null &&
                      e.dispatches_before > 0 &&
                      ` · ${e.dispatches_before} command(s) sent just before`}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};

export default GateWatchdogCard;
