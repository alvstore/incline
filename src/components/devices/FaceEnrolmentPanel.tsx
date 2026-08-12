import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  RefreshCw,
  ScanFace,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useMipsFleet } from "./useMipsFleet";

interface Props {
  branchId?: string;
  /** Faces the MIPS server itself holds — the number each gate should reach. */
  serverWithFace?: number;
}

interface LedgerRow {
  mips_device_id: number;
  device_name: string | null;
  person_sn: string;
  person_name: string | null;
  person_type: string;
  state: string;
  reason: string | null;
  attempts: number;
  last_attempt_at: string | null;
}

const stateBadge = (state: string) => {
  const base = "rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (state === "enrolled") {
    return <Badge className={`${base} bg-emerald-100 text-emerald-700 hover:bg-emerald-100`}>Verified</Badge>;
  }
  if (state === "rejected") {
    return <Badge className={`${base} bg-red-100 text-red-700 hover:bg-red-100`}>Retake needed</Badge>;
  }
  if (state === "unverified") {
    return <Badge className={`${base} bg-slate-100 text-slate-600 hover:bg-slate-100`}>Unverified</Badge>;
  }
  if (state === "missing") {
    return <Badge className={`${base} bg-amber-100 text-amber-700 hover:bg-amber-100`}>Dropped</Badge>;
  }
  return <Badge className={`${base} bg-amber-100 text-amber-700 hover:bg-amber-100`}>Awaiting push</Badge>;
};

const Metric = ({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "muted";
}) => (
  <div className="rounded-xl bg-background p-2.5">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`text-lg font-bold ${tone === "muted" ? "text-muted-foreground" : "text-foreground"}`}>
      {value}
    </p>
    {hint && <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>}
  </div>
);

/**
 * Per-gate face truth.
 *
 * The turnstile firmware exposes only two counters (people, faces) and never a
 * roster, so this panel deliberately separates what is *measured* (live gate
 * counters, MIPS server photo count) from what is *proven* (a single-person
 * push that moved a gate's counter). People the gate counts but nobody can name
 * are shown as "unverified" — never as enrolled.
 */
const FaceEnrolmentPanel = ({ branchId, serverWithFace }: Props) => {
  const queryClient = useQueryClient();
  const [sweeping, setSweeping] = useState(false);
  const { devices: liveDevices, isLoading: fleetLoading } = useMipsFleet(branchId);

  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["mips-face-ledger", branchId || "all"],
    queryFn: async (): Promise<LedgerRow[]> => {
      let q = supabase
        .from("mips_device_face_state")
        .select(
          "mips_device_id, device_name, person_sn, person_name, person_type, state, reason, attempts, last_attempt_at",
        )
        .order("state", { ascending: true })
        .limit(2000);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      return (data || []) as LedgerRow[];
    },
    refetchInterval: 60_000,
  });

  const runSweep = async () => {
    setSweeping(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("mips-face-sweep", {
        body: { branch_id: branchId, force: true },
      });
      if (fnErr) throw fnErr;
      const first = ((data as { branches?: Array<Record<string, number>> })?.branches ?? [])[0] ?? {};
      if (first.processed === 0 || first.processed === undefined) {
        toast.info("Sweep ran — nothing was queued for a push this tick");
      } else {
        toast.success(
          `Pushed ${first.processed} · verified ${first.enrolled_now ?? 0} · no counter change ${first.stalled ?? 0}`,
          { description: first.push_failed ? `${first.push_failed} push failure(s)` : undefined },
        );
      }
      queryClient.invalidateQueries({ queryKey: ["mips-face-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["mips-devices"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  };

  const deviceIds = [...new Set((rows || []).map((r) => r.mips_device_id))];
  const shouldCarry = serverWithFace ?? 0;

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
              <ScanFace className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Face truth per gate
              </p>
              <p className="text-xs text-muted-foreground">
                Live turnstile counters, and who we can actually prove by name
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] cursor-pointer rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
            onClick={runSweep}
            disabled={sweeping}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${sweeping ? "animate-spin" : ""}`} />
            Run sweep
          </Button>
        </div>

        {isError && (
          <div className="rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-700">
            Could not read the enrolment ledger: {error instanceof Error ? error.message : "unknown error"}.
            The numbers below are not shown rather than shown wrong.
          </div>
        )}

        {isLoading || fleetLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : deviceIds.length === 0 ? (
          <div className="rounded-xl bg-muted/40 p-6 text-center">
            <ScanFace className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No enrolment data yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run the sweep once — it pushes people one at a time and records which gate accepted each face.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {deviceIds.map((deviceId) => {
              const forDevice = (rows || []).filter((r) => r.mips_device_id === deviceId);
              const verified = forDevice.filter((r) => r.state === "enrolled");
              const unverified = forDevice.filter((r) => r.state === "unverified");
              const rejected = forDevice.filter((r) => r.state === "rejected");
              const awaiting = forDevice.filter((r) => r.state === "pending" || r.state === "missing");
              const live = liveDevices.find((d) => d.id === deviceId);
              const online = live ? live.onlineFlag === 1 || live.status === 1 : false;
              const faces = live?.faceCount ?? null;
              const persons = live?.personCount ?? null;
              const behind = faces !== null && shouldCarry > 0 ? Math.max(shouldCarry - faces, 0) : null;
              const name = live?.deviceName || forDevice[0]?.device_name || `Device ${deviceId}`;

              return (
                <div key={deviceId} className="rounded-xl bg-muted/30 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">{name}</p>
                    {live ? (
                      behind === null ? (
                        <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                          Server total unknown
                        </Badge>
                      ) : behind === 0 ? (
                        <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Counts match
                        </Badge>
                      ) : (
                        <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {behind} behind
                        </Badge>
                      )
                    ) : (
                      <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                        <WifiOff className="mr-1 h-3 w-3" />
                        No live reading
                      </Badge>
                    )}
                  </div>

                  {live && !online && (
                    <p className="mb-2 rounded-lg bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-700">
                      Gate is offline — the counters below are its last reported values.
                    </p>
                  )}

                  <div className="mb-2 grid grid-cols-3 gap-1.5">
                    <Metric label="Faces on gate" value={faces ?? "—"} hint="live counter" />
                    <Metric label="People on gate" value={persons ?? "—"} hint="live counter" />
                    <Metric
                      label="Should carry"
                      value={shouldCarry || "—"}
                      hint="MIPS server photos"
                      tone="muted"
                    />
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {verified.length} verified by name
                    </Badge>
                    <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                      <HelpCircle className="mr-1 h-3 w-3" />
                      {unverified.length} unverified
                    </Badge>
                    {awaiting.length > 0 && (
                      <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                        <Clock className="mr-1 h-3 w-3" />
                        {awaiting.length} awaiting push
                      </Badge>
                    )}
                    {rejected.length > 0 && (
                      <Badge className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {rejected.length} retake
                      </Badge>
                    )}
                  </div>

                  <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                    The turnstile reports a face count, never a name list. Only a single-person push that moves
                    that count proves an individual — everyone else stays “unverified”.
                  </p>

                  {awaiting.length + rejected.length > 0 && (
                    <ScrollArea className="h-40 rounded-lg">
                      <div className="space-y-1.5 pr-2">
                        {[...rejected, ...awaiting].map((r) => (
                          <div key={`${r.mips_device_id}-${r.person_sn}`} className="rounded-lg bg-background p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold">{r.person_name || r.person_sn}</p>
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {r.person_sn} · {r.person_type} · {r.attempts} attempt
                                  {r.attempts === 1 ? "" : "s"}
                                </p>
                              </div>
                              {stateBadge(r.state)}
                            </div>
                            {r.reason && (
                              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{r.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FaceEnrolmentPanel;
