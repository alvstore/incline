import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ScanFace } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

interface Props {
  branchId?: string;
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
  if (state === "enrolled") {
    return <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Enrolled</Badge>;
  }
  if (state === "rejected") {
    return <Badge className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">Photo rejected</Badge>;
  }
  if (state === "missing") {
    return <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Dropped</Badge>;
  }
  return <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Pending</Badge>;
};

/**
 * Per-gate, per-person face enrolment ledger.
 *
 * The turnstile firmware exposes only a face COUNT, never a roster, so the
 * sweep pushes one person at a time and attributes the count delta to them.
 * This panel renders the resulting truth: who is enrolled, who is still queued,
 * and whose photo the terminal cannot use (retake needed).
 */
const FaceEnrolmentPanel = ({ branchId }: Props) => {
  const queryClient = useQueryClient();
  const [sweeping, setSweeping] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["mips-face-ledger", branchId || "all"],
    queryFn: async (): Promise<LedgerRow[]> => {
      let q = supabase
        .from("mips_device_face_state")
        .select("mips_device_id, device_name, person_sn, person_name, person_type, state, reason, attempts, last_attempt_at")
        .order("state", { ascending: true })
        .limit(2000);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as LedgerRow[];
    },
    refetchInterval: 60_000,
  });

  const runSweep = async () => {
    setSweeping(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-face-sweep", {
        body: { branch_id: branchId, force: true },
      });
      if (error) throw error;
      const branches = (data as any)?.branches ?? [];
      const first = branches[0] ?? {};
      toast.success(
        first.at_parity
          ? "All gates already at face parity"
          : `Pushed ${first.processed ?? 0} · enrolled ${first.enrolled_now ?? 0}`,
      );
      queryClient.invalidateQueries({ queryKey: ["mips-face-ledger"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  };

  const devices = [...new Set((rows || []).map((r) => r.mips_device_id))];

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
              <ScanFace className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Face enrolment per gate
              </p>
              <p className="text-xs text-muted-foreground">
                Who actually carries a face template on each turnstile
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] cursor-pointer rounded-xl text-xs"
            onClick={runSweep}
            disabled={sweeping}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${sweeping ? "animate-spin" : ""}`} />
            Run sweep
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-xl bg-muted/40 p-6 text-center">
            <ScanFace className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No enrolment data yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run the sweep once — it pushes people one at a time and records which gate accepted each face.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {devices.map((deviceId) => {
              const forDevice = (rows || []).filter((r) => r.mips_device_id === deviceId);
              const enrolled = forDevice.filter((r) => r.state === "enrolled");
              const rejected = forDevice.filter((r) => r.state === "rejected");
              const pending = forDevice.filter((r) => r.state === "pending" || r.state === "missing");
              const name = forDevice[0]?.device_name || `Device ${deviceId}`;
              return (
                <div key={deviceId} className="rounded-xl bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {enrolled.length} / {forDevice.length} enrolled
                    </p>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                      <CheckCircle2 className="mr-1 h-3 w-3" />{enrolled.length}
                    </Badge>
                    <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                      <Clock className="mr-1 h-3 w-3" />{pending.length} pending
                    </Badge>
                    {rejected.length > 0 && (
                      <Badge className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">
                        <AlertTriangle className="mr-1 h-3 w-3" />{rejected.length} retake
                      </Badge>
                    )}
                  </div>
                  {pending.length + rejected.length > 0 && (
                    <ScrollArea className="h-40 rounded-lg">
                      <div className="space-y-1.5 pr-2">
                        {[...rejected, ...pending].map((r) => (
                          <div
                            key={`${r.mips_device_id}-${r.person_sn}`}
                            className="rounded-lg bg-background p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold">
                                  {r.person_name || r.person_sn}
                                </p>
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {r.person_sn} · {r.person_type} · {r.attempts} attempt{r.attempts === 1 ? "" : "s"}
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
