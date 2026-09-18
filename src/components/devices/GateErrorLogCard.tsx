import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertOctagon, CheckCircle2, FileWarning } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ErrorRow {
  id: string;
  created_at: string;
  source: string | null;
  severity: string | null;
  function_name: string | null;
  error_message: string;
  occurrence_count: number | null;
}

const GATE_KEYWORDS = ["mips", "device", "gate", "terminal", "person", "face", "access"];

const severityBadge = (severity: string | null) => {
  switch ((severity || "").toLowerCase()) {
    case "critical":
    case "error":
      return "bg-red-100 text-red-700";
    case "warning":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
};

const GateErrorLogCard = ({ branchId }: { branchId?: string }) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["gate-error-logs", branchId],
    queryFn: async (): Promise<ErrorRow[]> => {
      const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("error_logs")
        .select("id, created_at, source, severity, function_name, error_message, occurrence_count")
        .gte("created_at", since)
        .neq("severity", "info")
        .order("created_at", { ascending: false })
        .limit(120);
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as ErrorRow[])
        .filter((r) => {
          const hay = `${r.error_message} ${r.function_name ?? ""} ${r.source ?? ""}`.toLowerCase();
          return GATE_KEYWORDS.some((k) => hay.includes(k));
        })
        .slice(0, 25);
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-red-50 p-2 text-red-600">
            <FileWarning className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-base">Gate error log</CardTitle>
            <p className="text-xs text-muted-foreground">
              Errors from the last 72 hours that touched gates, people or face data.
            </p>
          </div>
        </div>
        <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {(data || []).length} entr{(data || []).length === 1 ? "y" : "ies"}
        </Badge>
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
            <p className="text-sm font-semibold text-slate-900">Could not load the error log</p>
            <p className="text-xs text-muted-foreground">Please refresh the page and try again.</p>
          </div>
        ) : (data || []).length === 0 ? (
          <div className="rounded-xl bg-emerald-50/60 p-6 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-600" />
            <p className="text-sm font-semibold text-slate-900">No gate-related errors</p>
            <p className="text-xs text-muted-foreground">
              Nothing failed around the gates in the last three days.
            </p>
          </div>
        ) : (
          (data || []).map((e) => (
            <div
              key={e.id}
              className="rounded-xl bg-slate-50 p-3 transition-colors duration-150 hover:bg-slate-100"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityBadge(e.severity)}`}>
                  {e.severity || "error"}
                </Badge>
                <span className="text-xs font-semibold text-slate-700">
                  {e.function_name || e.source || "system"}
                </span>
                {(e.occurrence_count ?? 1) > 1 && (
                  <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                    ×{e.occurrence_count}
                  </Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(e.created_at), "dd MMM, h:mm a")} ·{" "}
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="mt-1 break-words text-sm leading-relaxed text-slate-600">{e.error_message}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};

export default GateErrorLogCard;
