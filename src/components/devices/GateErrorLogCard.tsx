import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertOctagon, CheckCircle2, FileWarning, Clock, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Gate Errors — real gate failures come from three places:
 *  1. mips_sync_attempts with status=failed (push/photo/dispatch to a gate failed)
 *  2. access_device_health_events (watchdog: offline, counter stalls, reboots)
 *  3. error_logs rows whose source/function is a MIPS/device worker
 * The old version only read error_logs with loose keywords ("access", "person"),
 * which matched unrelated AI/lead warnings and missed every real gate failure.
 */

type Item = {
  id: string;
  at: string;
  kind: "sync" | "health" | "system";
  severity: "error" | "warning";
  title: string;
  message: string;
  device?: string | null;
  count: number;
};

interface SyncRow { id: string; created_at: string; operation: string | null; last_error: string | null; device_id: string | null; entity_type: string | null; response_code: number | null }
interface HealthRow { id: string; created_at: string; [k: string]: unknown }
interface ErrRow { id: string; created_at: string; source: string | null; severity: string | null; function_name: string | null; error_message: string; occurrence_count: number | null }

const GATE_SOURCE = /(mips|device|gate|terminal|biometric|howbody-scan|face)/i;
const OP_LABEL: Record<string, string> = {
  device_dispatch: "Send to gate",
  photo_upload: "Face photo upload",
  person_upsert: "Person sync",
  access_update: "Access validity update",
};

const badge = (s: Item["severity"]) => (s === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700");

const GateErrorLogCard = ({ branchId }: { branchId?: string }) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["gate-error-logs", branchId],
    queryFn: async () => {
      const since = new Date(Date.now() - 72 * 3600_000).toISOString();

      let sq = supabase
        .from("mips_sync_attempts")
        .select("id, created_at, operation, last_error, device_id, entity_type, response_code")
        .gte("created_at", since)
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(200);
      if (branchId) sq = sq.eq("branch_id", branchId);

      let dq = supabase
        .from("mips_sync_attempts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("status", "deferred");
      if (branchId) dq = dq.eq("branch_id", branchId);

      let devq = supabase.from("access_devices").select("id, device_name, serial_number");
      if (branchId) devq = devq.eq("branch_id", branchId);

      const [sync, deferred, devs, health, errs] = await Promise.all([
        sq,
        dq,
        devq,
        supabase.from("access_device_health_events").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
        supabase
          .from("error_logs")
          .select("id, created_at, source, severity, function_name, error_message, occurrence_count")
          .gte("created_at", since)
          .neq("severity", "info")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (sync.error) throw sync.error;

      const devMap = new Map<string, { device_name: string; serial_number: string | null }>();
      for (const d of (devs.data ?? []) as Array<{ id: string; device_name: string; serial_number: string | null }>) devMap.set(d.id, d);
      const localIds = new Set(devMap.keys());

      // Group identical sync failures so 40 rows of the same error read as one line ×40.
      const groups = new Map<string, Item>();
      for (const r of (sync.data ?? []) as SyncRow[]) {
        const msg = (r.last_error || `HTTP ${r.response_code ?? "error"}`).trim();
        const key = `${r.operation}|${r.device_id}|${msg}`;
        const g = groups.get(key);
        if (g) { g.count++; continue; }
        groups.set(key, {
          id: r.id,
          at: r.created_at,
          kind: "sync",
          severity: "error",
          title: OP_LABEL[r.operation ?? ""] ?? (r.operation || "Gate sync"),
          message: msg,
          device: r.device_id ? devMap.get(r.device_id)?.device_name ?? null : null,
          count: 1,
        });
      }

      const healthItems: Item[] = ((health.data ?? []) as HealthRow[])
        .filter((h) => !branchId || !h.device_id || localIds.has(String(h.device_id)))
        .map((h) => ({
          id: h.id,
          at: h.created_at,
          kind: "health",
          severity: /offline|down|fail|crash|stall/i.test(String(h.event_type ?? h.status ?? "")) ? "error" : "warning",
          title: String(h.event_type ?? h.status ?? "Gate health"),
          message: String(h.message ?? h.detail ?? h.details ?? ""),
          device: h.device_id ? devMap.get(String(h.device_id))?.device_name ?? null : null,
          count: 1,
        }));

      const sysItems: Item[] = ((errs.data ?? []) as ErrRow[])
        .filter((e) => GATE_SOURCE.test(`${e.source ?? ""} ${e.function_name ?? ""}`))
        .map((e) => ({
          id: e.id,
          at: e.created_at,
          kind: "system",
          severity: (e.severity || "").toLowerCase() === "warning" ? "warning" : "error",
          title: e.function_name || e.source || "system",
          message: e.error_message,
          count: e.occurrence_count ?? 1,
        }));

      const items = [...groups.values(), ...healthItems, ...sysItems]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 40);
      return { items, deferred: deferred.count ?? 0, failedTotal: (sync.data ?? []).length };
    },
    refetchInterval: 120_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Failed gate pushes", value: data?.failedTotal ?? 0, icon: Ban, tone: "bg-red-50 text-red-600" },
          { label: "Deferred (gate busy, retried)", value: data?.deferred ?? 0, icon: Clock, tone: "bg-amber-50 text-amber-600" },
          { label: "Issues to review", value: items.length, icon: FileWarning, tone: "bg-primary/10 text-primary" },
        ].map((k) => (
          <Card key={k.label} className="rounded-2xl border-none shadow-lg shadow-muted/30">
            <CardContent className="flex items-center gap-3 p-4">
              <span className={`rounded-full p-2 ${k.tone}`}><k.icon className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</p>
                {isLoading ? <Skeleton className="mt-1 h-6 w-10" /> : <p className="text-2xl font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Gate error log</CardTitle>
          <p className="text-xs text-muted-foreground">
            Failed pushes to gates, gate health alerts and device worker errors from the last 72 hours.
            Deferred pushes are normal pacing and retry automatically.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </>
          ) : isError ? (
            <div className="rounded-xl bg-red-50/70 p-6 text-center">
              <AlertOctagon className="mx-auto mb-2 h-6 w-6 text-red-600" />
              <p className="text-sm font-semibold text-foreground">Could not load the error log</p>
              <p className="text-xs text-muted-foreground">Please refresh the page and try again.</p>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-emerald-50/60 p-6 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-600" />
              <p className="text-sm font-semibold text-foreground">No gate failures in the last 3 days</p>
              <p className="text-xs text-muted-foreground">
                Every push reached the gates or is waiting its turn in the paced queue.
              </p>
            </div>
          ) : (
            items.map((e) => (
              <div key={`${e.kind}-${e.id}`} className="rounded-xl bg-muted/50 p-3 transition-colors duration-150 hover:bg-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge(e.severity)}`}>{e.severity}</Badge>
                  <span className="text-xs font-semibold text-foreground">{e.title}</span>
                  {e.device && (
                    <Badge className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{e.device}</Badge>
                  )}
                  {e.count > 1 && (
                    <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">×{e.count}</Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {format(new Date(e.at), "dd MMM, h:mm a")} · {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                  </span>
                </div>
                {e.message && <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{e.message}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GateErrorLogCard;
