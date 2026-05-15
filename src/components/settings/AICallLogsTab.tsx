// AI Call Logs tab — recent calls from ai_call_logs (lifted from former /ai-control-center page).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, AlertCircle } from "lucide-react";

export function AICallLogsTab() {
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

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 overflow-hidden">
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
            <Badge variant="outline" className="text-xs shrink-0">{l.purpose ?? "—"}</Badge>
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
