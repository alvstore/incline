import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface ChecklistRow {
  step_no: number;
  label: string;
  description: string | null;
  completed: boolean;
  evidence: string | null;
  completed_by: string | null;
  completed_at: string | null;
  updated_at: string;
}

const SEO_TITLE = "DR Readiness Checklist | The Incline";

export default function DRReadiness() {
  const qc = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["dr-readiness"],
    queryFn: async (): Promise<ChecklistRow[]> => {
      const { data, error } = await supabase
        .from("dr_readiness_checklist")
        .select("*")
        .order("step_no", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChecklistRow[];
    },
  });

  const operational = useMemo(
    () => Boolean(rows?.length) && rows!.every((r) => r.completed),
    [rows],
  );
  const completedCount = rows?.filter((r) => r.completed).length ?? 0;

  const updateStep = useMutation({
    mutationFn: async (vars: { step_no: number; completed?: boolean; evidence?: string }) => {
      const patch: Partial<ChecklistRow> & { completed_by?: string | null; completed_at?: string | null } = {};
      if (vars.completed !== undefined) {
        patch.completed = vars.completed;
        const { data: u } = await supabase.auth.getUser();
        patch.completed_by = vars.completed ? u.user?.id ?? null : null;
        patch.completed_at = vars.completed ? new Date().toISOString() : null;
      }
      if (vars.evidence !== undefined) patch.evidence = vars.evidence;

      const { error } = await supabase
        .from("dr_readiness_checklist")
        .update(patch)
        .eq("step_no", vars.step_no);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dr-readiness"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  // Set page title for SEO
  if (typeof document !== "undefined") document.title = SEO_TITLE;

  return (
    <div className="container mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          Disaster Recovery — Readiness Checklist
        </h1>
        <p className="text-sm text-muted-foreground">
          DR is considered <strong>operational</strong> only when all 10 steps are signed off.
          Until then, the standby environment may be incomplete.
        </p>
      </header>

      <Card className="rounded-2xl shadow-lg shadow/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Status</CardTitle>
            <CardDescription>
              {completedCount} of {rows?.length ?? 10} steps complete
            </CardDescription>
          </div>
          {operational ? (
            <Badge className="gap-1 rounded-full bg-success/15 px-3 py-1 text-success hover:bg-success/15">
              <ShieldCheck className="h-4 w-4" /> DR Operational
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 rounded-full bg-warning/15 px-3 py-1 text-warning hover:bg-warning/15">
              <ShieldAlert className="h-4 w-4" /> Not Yet Operational
            </Badge>
          )}
        </CardHeader>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <ol className="space-y-3">
          {rows?.map((row) => (
            <li key={row.step_no}>
              <Card className={`rounded-2xl shadow-md transition-all ${row.completed ? "bg-success/10" : "bg-card"}`}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`step-${row.step_no}`}
                      checked={row.completed}
                      onCheckedChange={(v) =>
                        updateStep.mutate({ step_no: row.step_no, completed: Boolean(v) })
                      }
                      aria-label={`Mark step ${row.step_no} complete`}
                      className="mt-1"
                    />
                    <div className="min-w-[2rem] text-sm font-bold text-muted-foreground">
                      {String(row.step_no).padStart(2, "0")}
                    </div>
                  </div>

                  <div className="flex-1 space-y-2">
                    <label
                      htmlFor={`step-${row.step_no}`}
                      className="block cursor-pointer text-sm font-semibold text-foreground"
                    >
                      {row.label}
                    </label>
                    {row.description && (
                      <p className="text-xs leading-relaxed text-muted-foreground">{row.description}</p>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        defaultValue={row.evidence ?? ""}
                        placeholder="Evidence (backup ID, drill_log id, PITR plan, etc.)"
                        className="text-xs"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if ((row.evidence ?? "") !== v) {
                            updateStep.mutate({ step_no: row.step_no, evidence: v || "" });
                          }
                        }}
                      />
                      {row.completed && row.completed_at && (
                        <div className="flex items-center gap-1 whitespace-nowrap text-xs text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {format(new Date(row.completed_at), "dd MMM yyyy, HH:mm")}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <Card className="rounded-2xl bg-muted shadow-sm">
        <CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">What this means</p>
          <p>
            The checklist is the single source of truth for DR readiness. The "DR Operational" badge
            (and the green banner sitewide) only appears when every box is ticked. Each step requires
            evidence — a backup ID, a <code>dr_drill_log</code> row id, a PITR plan name, etc. —
            so the audit log can prove DR was actually exercised, not just claimed.
          </p>
          <p>
            Full procedure: <code>docs/dr-runbook.md</code>. Quarterly drill criteria:{" "}
            <code>dr_drill_log</code> table.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
