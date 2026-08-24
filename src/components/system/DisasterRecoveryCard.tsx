import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, ScanSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface SyncReport {
  ok: boolean;
  version?: string;
  mode?: string;
  startedAt: string;
  finishedAt?: string;
  mirrored: {
    schema?: { dumpedBytes: number; uploadedPath: string | null };
    authUsers?: { listed: number; created: number; updated: number; failed: number };
    storage?: {
      buckets: { ensured: number; failed: number };
      objects: { copied: number; skipped: number; failed: number; bytes: number };
      perBucket?: Array<{ bucket: string; objects: number; bytes: number; failed: number }>;
    };
    rows?: {
      tables: number;
      rowsUpserted: number;
      tablesFailed: number;
    };
    verify?: {
      tables: Array<{ table: string; primary: number; standby: number; delta: number }>;
      storage: Array<{
        bucket: string;
        primaryObjects: number;
        standbyObjects: number;
        primaryBytes: number;
        standbyBytes: number;
        deltaObjects: number;
        deltaBytes: number;
      }>;
      allInSync: boolean;
    };
  };
  errors: string[];
}

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const PHASES: Array<{ pct: number; label: string }> = [
  { pct: 5, label: "Connecting to fallback database…" },
  { pct: 15, label: "Dumping schema…" },
  { pct: 30, label: "Mirroring auth users…" },
  { pct: 55, label: "Mirroring rows…" },
  { pct: 75, label: "Copying storage files…" },
  { pct: 92, label: "Finalising…" },
];

export function DisasterRecoveryCard() {
  const { hasAnyRole } = useAuth();
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [phaseLabel, setPhaseLabel] = useState<string>("");
  const intervalRef = useRef<number | null>(null);
  const isOwner = hasAnyRole(["owner"]);

  const stopTicker = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startTicker = () => {
    stopTicker();
    let i = 0;
    setProgress(PHASES[0].pct);
    setPhaseLabel(PHASES[0].label);
    intervalRef.current = window.setInterval(() => {
      i = Math.min(i + 1, PHASES.length - 1);
      setProgress(PHASES[i].pct);
      setPhaseLabel(PHASES[i].label);
    }, 1400);
  };

  useEffect(() => () => stopTicker(), []);

  const invokeReplicate = async (mode: "all" | "verify") => {
    const { data, error } = await supabase.functions.invoke("dr-replicate", {
      body: { mode },
    });
    if (error) throw error;
    return data as SyncReport;
  };

  const sync = useMutation({
    mutationFn: async () => {
      startTicker();
      return invokeReplicate("all");
    },
    onSuccess: (report) => {
      stopTicker();
      setProgress(100);
      setPhaseLabel("Sync complete");
      setLastReport(report);
      if (report.ok) {
        const u = report.mirrored.authUsers?.listed ?? 0;
        const f = report.mirrored.storage?.objects.copied ?? 0;
        const b = report.mirrored.storage?.objects.bytes ?? 0;
        toast.success(`Sync complete: ${u} users, ${f} files (${formatBytes(b)})`);
      } else {
        toast.warning(`Sync finished with ${report.errors.length} error(s)`);
      }
      window.setTimeout(() => {
        setProgress(0);
        setPhaseLabel("");
      }, 2500);
    },
    onError: (e: Error) => {
      stopTicker();
      setProgress(0);
      setPhaseLabel("");
      toast.error(`Sync failed: ${e.message}`);
    },
  });

  const verify = useMutation({
    mutationFn: () => invokeReplicate("verify"),
    onSuccess: (report) => {
      setLastReport(report);
      const v = report.mirrored.verify;
      if (v?.allInSync) toast.success("Parity OK — primary and fallback are 1:1");
      else {
        const tDrift = v?.tables.filter((t) => t.delta !== 0).length ?? 0;
        const sDrift = v?.storage.filter((s) => s.deltaObjects !== 0 || s.deltaBytes !== 0).length ?? 0;
        toast.warning(`Drift detected: ${tDrift} tables, ${sDrift} buckets`);
      }
    },
    onError: (e: Error) => toast.error(`Verify failed: ${e.message}`),
  });

  if (!isOwner) return null;

  const isRunning = sync.isPending || verify.isPending;
  const v = lastReport?.mirrored.verify;
  const tableDrift = v?.tables.filter((t) => t.delta !== 0) ?? [];
  const storageDrift = v?.storage.filter((s) => s.deltaObjects !== 0 || s.deltaBytes !== 0) ?? [];

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-xl bg-success/10 text-success">
            <ShieldCheck className="h-5 w-5" />
          </div>
          Disaster Recovery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground leading-relaxed">
          The standby database is dumped automatically every night at{" "}
          <span className="font-medium text-foreground">02:30 IST</span> — schema,
          all table data, auth users and storage files. Run a dump manually before
          risky migrations, or verify 1:1 parity any time.
        </div>

        <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
          Cold standby: server functions are <span className="font-medium text-foreground">not</span>{" "}
          auto-deployed to the standby project. In a real recovery, restore points at the
          mirrored database and functions are deployed from this project in one step.
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => sync.mutate()} disabled={isRunning} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
            {sync.isPending ? "Dumping…" : "Run dump now"}
          </Button>
          <Button
            onClick={() => verify.mutate()}
            disabled={isRunning}
            variant="outline"
            className="gap-2"
          >
            <ScanSearch className={`h-4 w-4 ${verify.isPending ? "animate-spin" : ""}`} />
            {verify.isPending ? "Verifying…" : "Verify parity"}
          </Button>
        </div>


        {(sync.isPending || progress > 0) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{phaseLabel || "Working…"}</span>
              <span className="font-semibold text-foreground tabular-nums">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {lastReport && (
          <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {lastReport.ok ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Last {lastReport.mode ?? "sync"} succeeded
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Last {lastReport.mode ?? "sync"} had {lastReport.errors.length} issue(s)
                </>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              {new Date(lastReport.startedAt).toLocaleString("en-IN")}
              {lastReport.finishedAt && (
                <>
                  {" · "}
                  {Math.max(
                    1,
                    Math.round(
                      (new Date(lastReport.finishedAt).getTime() -
                        new Date(lastReport.startedAt).getTime()) / 1000,
                    ),
                  )}
                  s
                </>
              )}
            </div>


            {lastReport.mirrored.authUsers && (
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  Auth users:{" "}
                  <Badge variant="secondary">{lastReport.mirrored.authUsers.listed}</Badge>
                </div>
                <div>
                  Buckets:{" "}
                  <Badge variant="secondary">
                    {lastReport.mirrored.storage?.buckets.ensured ?? 0}
                  </Badge>
                </div>
                <div>
                  Files copied:{" "}
                  <Badge variant="secondary">
                    {lastReport.mirrored.storage?.objects.copied ?? 0}
                  </Badge>
                </div>
                <div>
                  Size:{" "}
                  <Badge variant="secondary">
                    {formatBytes(lastReport.mirrored.storage?.objects.bytes ?? 0)}
                  </Badge>
                </div>
                {lastReport.mirrored.rows && (
                  <>
                    <div>
                      Tables:{" "}
                      <Badge variant="secondary">{lastReport.mirrored.rows.tables}</Badge>
                    </div>
                    <div>
                      Rows upserted:{" "}
                      <Badge variant="secondary">{lastReport.mirrored.rows.rowsUpserted}</Badge>
                    </div>
                  </>
                )}
                {lastReport.mirrored.schema && (
                  <div className="col-span-2">
                    Schema dump:{" "}
                    <Badge variant="secondary">
                      {formatBytes(lastReport.mirrored.schema.dumpedBytes)}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {v && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  {v.allInSync ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-success font-medium">
                        Primary and fallback are 1:1
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <span className="text-warning font-medium">
                        {tableDrift.length} table(s) + {storageDrift.length} bucket(s) drifting
                      </span>
                    </>
                  )}
                </div>
                {(tableDrift.length > 0 || storageDrift.length > 0) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer">View drift</summary>
                    <ul className="mt-2 space-y-1 list-disc pl-4 text-warning">
                      {tableDrift.slice(0, 20).map((t) => (
                        <li key={t.table}>
                          {t.table}: primary {t.primary} vs fallback {t.standby} (Δ {t.delta})
                        </li>
                      ))}
                      {storageDrift.map((s) => (
                        <li key={s.bucket}>
                          {s.bucket}: primary {s.primaryObjects} obj / {formatBytes(s.primaryBytes)} vs
                          fallback {s.standbyObjects} obj / {formatBytes(s.standbyBytes)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {lastReport.errors.length > 0 && (
              <details className="text-xs text-warning">
                <summary className="cursor-pointer">View errors</summary>
                <ul className="mt-2 space-y-1 list-disc pl-4">
                  {lastReport.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
