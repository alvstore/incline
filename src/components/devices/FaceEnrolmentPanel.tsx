import { useQueryClient } from "@tanstack/react-query";
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
import { supabase } from "@/integrations/supabase/client";
import { useMipsFleet } from "./useMipsFleet";

interface Props {
  branchId?: string;
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
 * Every number here comes from `useMipsFleet` — the same hook the health strip,
 * attention bar and fleet tab read — so the Fleet and Personnel Sync tabs can
 * never show different counters for the same gate. The turnstile firmware
 * exposes only two counters (people, faces) and never a roster, so this panel
 * separates what is *measured* (gate counters, MIPS server photo count) from
 * what is *proven* (a single-person push that moved a gate's counter).
 */
const FaceEnrolmentPanel = ({ branchId }: Props) => {
  const queryClient = useQueryClient();
  const [sweeping, setSweeping] = useState(false);
  const {
    gates,
    target,
    isLoading: fleetLoading,
    ledgerLoading,
    ledgerError,
  } = useMipsFleet(branchId);

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
                {target > 0
                  ? `The office has ${target} face photos on file — every gate should hold all of them`
                  : "Live turnstile counters, and who we can actually prove by name"}
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

        {ledgerError && (
          <div className="rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-700">
            Could not read the enrolment ledger:{" "}
            {ledgerError instanceof Error ? ledgerError.message : "unknown error"}. The numbers below are not
            shown rather than shown wrong.
          </div>
        )}

        {ledgerLoading || fleetLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : gates.length === 0 ? (
          <div className="rounded-xl bg-muted/40 p-6 text-center">
            <ScanFace className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No enrolment data yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run the sweep once — it pushes people one at a time and records which gate accepted each face.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {gates.map((gate) => {
              const { behind, faces, persons, pct } = gate;
              const waiting = [...gate.rejected, ...gate.awaiting].sort((a, b) =>
                (a.person_name || a.person_sn).localeCompare(b.person_name || b.person_sn),
              );

              return (
                <div key={gate.deviceId} className="rounded-xl bg-muted/30 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">{gate.name}</p>
                    {faces === null ? (
                      <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                        <WifiOff className="mr-1 h-3 w-3" />
                        No live reading
                      </Badge>
                    ) : behind === null ? (
                      <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                        Can't compare yet
                      </Badge>
                    ) : behind === 0 ? (
                      <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Fully up to date
                      </Badge>
                    ) : (
                      <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Missing {behind} photo{behind === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>

                  {/* Plain-language headline: what the numbers actually mean. */}
                  <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                    {faces === null
                      ? "This gate is not reporting right now, so we can't tell how many face photos it holds."
                      : behind === null
                        ? `This gate holds ${faces} face photos. We don't have the office total to compare against yet.`
                        : behind === 0
                          ? `This gate holds all ${gate.target} face photos the office has on file — nobody is missing.`
                          : `This gate holds ${faces} of the ${gate.target} face photos the office has on file, so ${behind} ${behind === 1 ? "person's photo has" : "people's photos have"} not reached it yet.`}
                  </p>

                  {pct !== null && (
                    <div className="mb-2">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            behind === 0 ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                          style={{ width: `${pct}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${gate.name} face photo sync progress`}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {pct}% of the office's face photos are on this gate
                      </p>
                    </div>
                  )}

                  {faces !== null && !gate.online && (
                    <p className="mb-2 rounded-lg bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-700">
                      Gate is offline — the counters below are its last reported values.
                    </p>
                  )}

                  <div className="mb-2 grid grid-cols-3 gap-1.5">
                    <Metric label="Photos on this gate" value={faces ?? "—"} hint="reported by the gate" />
                    <Metric label="People on this gate" value={persons ?? "—"} hint="reported by the gate" />
                    <Metric
                      label="Photos in the office"
                      value={gate.target || "—"}
                      hint="the target every gate should reach"
                      tone="muted"
                    />
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {gate.verified} confirmed by name
                    </Badge>
                    <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                      <HelpCircle className="mr-1 h-3 w-3" />
                      {gate.unverified} counted but not named
                    </Badge>
                    {waiting.length > 0 && (
                      <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                        <Clock className="mr-1 h-3 w-3" />
                        {gate.awaiting.length} still to send
                      </Badge>
                    )}
                    {gate.rejected.length > 0 && (
                      <Badge className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {gate.rejected.length} need a new photo
                      </Badge>
                    )}
                  </div>

                  <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                    Confirmed and counted always add up to the {faces ?? "—"} photos this gate reports. The gate
                    never sends a list of names, so we can only name someone once their photo was pushed on its
                    own and the gate's counter moved.
                  </p>

                  {gate.gapWaiting + gate.gapRejected > 0 && (
                    <p className="mb-2 rounded-lg bg-background p-2 text-[10px] leading-relaxed text-muted-foreground">
                      Named people this gate is still missing:{" "}
                      <strong>{gate.gapWaiting} waiting to be sent</strong> and{" "}
                      <strong>{gate.gapRejected} needing a clearer photo</strong>. Re-syncing only helps the
                      first group. Older records on the server that no gate needs are not counted here.
                    </p>
                  )}

                  {waiting.length > 0 && (
                    <ScrollArea className="h-40 rounded-lg">
                      <div className="space-y-1.5 pr-2">
                        {waiting.map((r) => (
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
