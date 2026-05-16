// AI Call Logs tab — recent calls from ai_call_logs with filters, expandable errors,
// status filter chips, and a real bulk-clear that respects RLS counts.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type WindowKey = "1" | "7" | "30" | "all";
type StatusFilter = "all" | "success" | "fallback" | "error";

const WINDOWS: { value: WindowKey; label: string; days: number | null }[] = [
  { value: "1", label: "Older than 1 day", days: 1 },
  { value: "7", label: "Older than 7 days", days: 7 },
  { value: "30", label: "Older than 30 days", days: 30 },
  { value: "all", label: "All logs", days: null },
];

const STATUS_CHIPS: { value: StatusFilter; label: string; className: string }[] = [
  { value: "all", label: "All", className: "bg-slate-100 text-slate-700" },
  { value: "success", label: "Success", className: "bg-emerald-100 text-emerald-700" },
  { value: "fallback", label: "Fallback", className: "bg-amber-100 text-amber-700" },
  { value: "error", label: "Error", className: "bg-red-100 text-red-700" },
];

export function AICallLogsTab() {
  const qc = useQueryClient();
  const [windowKey, setWindowKey] = useState<WindowKey>("7");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: logs = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ai_call_logs_recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_call_logs")
        .select("id, purpose, provider, model, status, duration_ms, fallback_used, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
    refetchInterval: 10000,
  });

  const visibleLogs = useMemo(() => {
    if (statusFilter === "all") return logs;
    if (statusFilter === "fallback") return logs.filter((l: any) => l.fallback_used);
    return logs.filter((l: any) => l.status === statusFilter);
  }, [logs, statusFilter]);

  const clearMutation = useMutation({
    mutationFn: async () => {
      const win = WINDOWS.find((w) => w.value === windowKey)!;
      const cutoff = win.days !== null
        ? new Date(Date.now() - win.days * 24 * 60 * 60 * 1000).toISOString()
        : null;
      let q = supabase.from("ai_call_logs").delete({ count: "exact" });
      q = cutoff ? q.lt("created_at", cutoff) : q.not("id", "is", null);
      const { error, count } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    onSuccess: (count) => {
      if (count === 0) {
        toast.info("No logs matched — nothing to delete.");
      } else {
        toast.success(`Cleared ${count} AI call log${count === 1 ? "" : "s"}`);
      }
      qc.invalidateQueries({ queryKey: ["ai_call_logs_recent"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to clear logs"),
  });

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyError = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 overflow-hidden">
      <div className="flex flex-col gap-3 p-4 border-b bg-slate-50/50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-slate-600">
            Showing <span className="font-semibold text-slate-900">{visibleLogs.length}</span> of {logs.length} AI calls
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh logs"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Select value={windowKey} onValueChange={(v) => setWindowKey(v as WindowKey)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer text-red-600 border-red-200 hover:bg-red-50"
                  disabled={clearMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Clear
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear AI call logs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes <strong>{WINDOWS.find((w) => w.value === windowKey)?.label.toLowerCase()}</strong>{" "}
                    from <code className="text-xs">ai_call_logs</code>. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => clearMutation.mutate()}
                  >
                    Delete logs
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_CHIPS.map((chip) => {
            const active = statusFilter === chip.value;
            const count = chip.value === "all"
              ? logs.length
              : chip.value === "fallback"
              ? logs.filter((l: any) => l.fallback_used).length
              : logs.filter((l: any) => l.status === chip.value).length;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => setStatusFilter(chip.value)}
                className={`cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                  active ? chip.className + " ring-2 ring-offset-1 ring-indigo-300" : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {chip.label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y">
        {isLoading && <div className="p-6 text-sm text-slate-500">Loading…</div>}
        {!isLoading && visibleLogs.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <Activity className="h-8 w-8 text-slate-300" />
            {logs.length === 0 ? "No AI calls logged yet." : "No calls match this filter."}
          </div>
        )}
        {visibleLogs.map((l: any) => {
          const isOpen = expanded.has(l.id);
          const hasDetails = !!l.error_message;
          return (
            <div key={l.id} className="hover:bg-slate-50 transition-colors">
              <button
                type="button"
                onClick={() => hasDetails && toggleExpanded(l.id)}
                className={`w-full p-3 flex items-center gap-3 text-sm text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
                aria-expanded={isOpen}
              >
                {hasDetails ? (
                  isOpen ? (
                    <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                  )
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                {l.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : l.status === "fallback" ? (
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <Badge variant="outline" className="text-xs shrink-0">
                  {l.purpose ?? "—"}
                </Badge>
                <span className="text-slate-600 truncate flex-1">
                  {l.provider} · {l.model ?? "—"}
                  {l.fallback_used && <span className="ml-2 text-amber-600">(fallback)</span>}
                  {l.error_message && <span className="ml-2 text-red-600 truncate">— {l.error_message}</span>}
                </span>
                <span className="text-xs text-slate-400 shrink-0">{l.duration_ms}ms</span>
                <span className="text-xs text-slate-400 shrink-0">{new Date(l.created_at).toLocaleString()}</span>
              </button>
              {isOpen && hasDetails && (
                <div className="px-3 pb-3 pl-10">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Full error
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs cursor-pointer"
                        onClick={() => copyError(l.error_message ?? "")}
                      >
                        <Copy className="h-3 w-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <pre className="text-[11px] text-slate-700 whitespace-pre-wrap break-all font-mono max-h-72 overflow-auto">
                      {l.error_message}
                    </pre>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                      <div><span className="font-semibold text-slate-600">Provider:</span> {l.provider}</div>
                      <div><span className="font-semibold text-slate-600">Model:</span> {l.model ?? "—"}</div>
                      <div><span className="font-semibold text-slate-600">Purpose:</span> {l.purpose ?? "—"}</div>
                      <div><span className="font-semibold text-slate-600">Status:</span> {l.status}</div>
                      <div><span className="font-semibold text-slate-600">Duration:</span> {l.duration_ms}ms</div>
                      <div><span className="font-semibold text-slate-600">Logged:</span> {new Date(l.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
