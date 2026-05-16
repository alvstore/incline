// AI Call Logs tab — recent calls from ai_call_logs with filters + bulk clear.
import { useState } from "react";
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
import { Activity, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

type WindowKey = "1" | "7" | "30" | "all";

const WINDOWS: { value: WindowKey; label: string; days: number | null }[] = [
  { value: "1", label: "Older than 1 day", days: 1 },
  { value: "7", label: "Older than 7 days", days: 7 },
  { value: "30", label: "Older than 30 days", days: 30 },
  { value: "all", label: "All logs", days: null },
];

export function AICallLogsTab() {
  const qc = useQueryClient();
  const [windowKey, setWindowKey] = useState<WindowKey>("7");

  const { data: logs = [], isLoading } = useQuery({
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

  const clearMutation = useMutation({
    mutationFn: async () => {
      const win = WINDOWS.find((w) => w.value === windowKey)!;
      const cutoff = win.days !== null
        ? new Date(Date.now() - win.days * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const del = supabase.from("ai_call_logs").delete();
      const q = cutoff ? del.lt("created_at", cutoff) : del.not("id", "is", null);
      const { error, data } = await q.select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (count) => {
      toast.success(`Cleared ${count} AI call log${count === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["ai_call_logs_recent"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to clear logs"),
  });

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b bg-slate-50/50">
        <div className="text-sm text-slate-600">
          Showing latest <span className="font-semibold text-slate-900">{logs.length}</span> AI calls
        </div>
        <div className="flex items-center gap-2">
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

      <div className="divide-y">
        {isLoading && <div className="p-6 text-sm text-slate-500">Loading…</div>}
        {!isLoading && logs.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <Activity className="h-8 w-8 text-slate-300" />
            No AI calls logged yet.
          </div>
        )}
        {logs.map((l: any) => (
          <div key={l.id} className="p-3 flex items-center gap-3 text-sm hover:bg-slate-50">
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
          </div>
        ))}
      </div>
    </Card>
  );
}
