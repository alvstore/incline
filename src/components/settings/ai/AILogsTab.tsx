// SSOT logs viewer — merges the former "Call Logs" (ai_call_logs) and
// "Tool Logs" (ai_tool_logs) tabs into one surface with a segmented switch.
// Different tables = different shapes, but identical UX (window, status, clear).
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

type Stream = "llm" | "tools";
type WindowKey = "1" | "7" | "30" | "all";
type StatusFilter = "all" | "success" | "fallback" | "error";
type PlatformFilter = "all" | "whatsapp" | "instagram" | "messenger";

const WINDOWS: { value: WindowKey; label: string; days: number | null }[] = [
  { value: "1", label: "Older than 1 day", days: 1 },
  { value: "7", label: "Older than 7 days", days: 7 },
  { value: "30", label: "Older than 30 days", days: 30 },
  { value: "all", label: "All logs", days: null },
];

const PLATFORM_CHIPS: { value: PlatformFilter; label: string; className: string }[] = [
  { value: "all", label: "All channels", className: "bg-muted text-foreground" },
  { value: "whatsapp", label: "WhatsApp", className: "bg-success/15 text-success" },
  { value: "instagram", label: "Instagram", className: "bg-destructive/15 text-destructive" },
  { value: "messenger", label: "Messenger", className: "bg-info/15 text-info" },
];

const PLATFORM_BADGE: Record<string, string> = {
  whatsapp: "bg-success/10 text-success border-success/25",
  instagram: "bg-destructive/10 text-destructive border-destructive/25",
  messenger: "bg-info/10 text-info border-info/25",
};

const STATUS_CHIPS: { value: StatusFilter; label: string; className: string }[] = [
  { value: "all", label: "All", className: "bg-muted text-foreground" },
  { value: "success", label: "Success", className: "bg-success/15 text-success" },
  { value: "fallback", label: "Fallback", className: "bg-warning/15 text-warning" },
  { value: "error", label: "Error", className: "bg-destructive/15 text-destructive" },
];

const STREAM_META: Record<Stream, { label: string; table: string; sub: string; icon: typeof Activity }> = {
  llm: {
    label: "LLM calls",
    table: "ai_call_logs",
    sub: "Calls to the language model — latency, fallback events, provider errors.",
    icon: Activity,
  },
  tools: {
    label: "Tool calls",
    table: "ai_tool_logs",
    sub: "Function/tool invocations the agent made — e.g. get_membership_status.",
    icon: Wrench,
  },
};

export function AILogsTab() {
  const qc = useQueryClient();
  const [stream, setStream] = useState<Stream>("llm");
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const llmQuery = useQuery({
    queryKey: ["ai_call_logs_recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_call_logs")
        .select(
          "id, purpose, provider, model, status, duration_ms, fallback_used, error_message, created_at, platform, contact_key",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
    refetchInterval: 10000,
    enabled: stream === "llm",
  });

  const toolQuery = useQuery({
    queryKey: ["ai_tool_logs_recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_tool_logs")
        .select(
          "id, tool_name, status, execution_time_ms, error_message, created_at, phone_number, platform, contact_key",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
    refetchInterval: 10000,
    enabled: stream === "tools",
  });

  const active = stream === "llm" ? llmQuery : toolQuery;
  const logs = useMemo(() => (active.data ?? []) as any[], [active.data]);

  const visibleLogs = useMemo(() => {
    let out = logs;
    if (platformFilter !== "all") {
      out = out.filter((l: any) => (l.platform ?? "whatsapp") === platformFilter);
    }
    if (stream === "tools") {
      if (statusFilter === "all") return out;
      if (statusFilter === "fallback") return [];
      return out.filter((l) => l.status === statusFilter);
    }
    if (statusFilter === "all") return out;
    if (statusFilter === "fallback") return out.filter((l: any) => l.fallback_used);
    return out.filter((l: any) => l.status === statusFilter);
  }, [logs, statusFilter, platformFilter, stream]);

  const clearMutation = useMutation({
    mutationFn: async () => {
      const win = WINDOWS.find((w) => w.value === windowKey)!;
      const cutoff =
        win.days !== null
          ? new Date(Date.now() - win.days * 24 * 60 * 60 * 1000).toISOString()
          : null;
      const table = STREAM_META[stream].table as "ai_call_logs" | "ai_tool_logs";
      let q = supabase.from(table).delete({ count: "exact" });
      q = cutoff ? q.lt("created_at", cutoff) : q.not("id", "is", null);
      const { error, count } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    onSuccess: (count) => {
      if (count === 0) toast.info("No logs matched — nothing to delete.");
      else toast.success(`Cleared ${count} log${count === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: [STREAM_META[stream].table + "_recent"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to clear logs"),
  });

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyError = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const StreamIcon = STREAM_META[stream].icon;

  return (
    <Card className="rounded-2xl shadow-lg shadow/50 overflow-hidden">
      {/* Stream selector */}
      <div className="p-4 border-b bg-muted/50 space-y-3">
        <div className="flex items-center gap-2 p-1 bg-card rounded-xl border w-fit">
          {(Object.keys(STREAM_META) as Stream[]).map((s) => {
            const Icon = STREAM_META[s].icon;
            const isActive = stream === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStream(s);
                  setStatusFilter("all");
                }}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {STREAM_META[s].label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <StreamIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {STREAM_META[stream].sub}
        </p>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-semibold text-foreground">{visibleLogs.length}</span>{" "}
            of {logs.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => active.refetch()}
              disabled={active.isFetching}
              aria-label="Refresh logs"
            >
              <RefreshCw className={`h-4 w-4 ${active.isFetching ? "animate-spin" : ""}`} />
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
                  className="cursor-pointer text-destructive border-destructive/25 hover:bg-destructive/10"
                  disabled={clearMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Clear
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear {STREAM_META[stream].label.toLowerCase()}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes{" "}
                    <strong>{WINDOWS.find((w) => w.value === windowKey)?.label.toLowerCase()}</strong>{" "}
                    from <code className="text-xs">{STREAM_META[stream].table}</code>. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive"
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
            if (stream === "tools" && chip.value === "fallback") return null;
            const isActive = statusFilter === chip.value;
            const count =
              chip.value === "all"
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
                  isActive
                    ? chip.className + " ring-2 ring-offset-1 ring-primary/40"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted"
                }`}
              >
                {chip.label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {PLATFORM_CHIPS.map((chip) => {
            const isActive = platformFilter === chip.value;
            const count =
              chip.value === "all"
                ? logs.length
                : logs.filter((l: any) => (l.platform ?? "whatsapp") === chip.value).length;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => setPlatformFilter(chip.value)}
                className={`cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                  isActive
                    ? chip.className + " ring-2 ring-offset-1 ring-primary/40"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted"
                }`}
              >
                {chip.label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y">
        {active.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {!active.isLoading && visibleLogs.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <StreamIcon className="h-8 w-8 text-muted-foreground" />
            {logs.length === 0 ? "Nothing logged yet." : "No entries match this filter."}
          </div>
        )}

        {stream === "llm" &&
          visibleLogs.map((l: any) => {
            const isOpen = expanded.has(l.id);
            const hasDetails = !!l.error_message;
            return (
              <div key={l.id} className="hover:bg-muted transition-colors">
                <button
                  type="button"
                  onClick={() => hasDetails && toggleExpanded(l.id)}
                  className={`w-full p-3 flex items-center gap-3 text-sm text-left ${
                    hasDetails ? "cursor-pointer" : "cursor-default"
                  }`}
                  aria-expanded={isOpen}
                >
                  {hasDetails ? (
                    isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  {l.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  ) : l.status === "fallback" ? (
                    <AlertCircle className="h-4 w-4 text-warning shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <Badge variant="outline" className="text-xs shrink-0">
                    {l.purpose ?? "—"}
                  </Badge>
                  {l.platform && (
                    <span className={`text-[10px] font-medium uppercase tracking-wide rounded-full border px-1.5 py-0.5 shrink-0 ${PLATFORM_BADGE[l.platform] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {l.platform}
                    </span>
                  )}
                  <span className="text-muted-foreground truncate flex-1">
                    {l.provider} · {l.model ?? "—"}
                    {l.fallback_used && <span className="ml-2 text-warning">(fallback)</span>}
                    {l.error_message && (
                      <span className="ml-2 text-destructive truncate">— {l.error_message}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{l.duration_ms}ms</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </button>
                {isOpen && hasDetails && (
                  <div className="px-3 pb-3 pl-10">
                    <div className="rounded-lg border border-border bg-muted p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                      <pre className="text-[11px] text-foreground whitespace-pre-wrap break-all font-mono max-h-72 overflow-auto">
                        {l.error_message}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {stream === "tools" &&
          visibleLogs.map((l: any) => (
            <div key={l.id} className="p-3 flex items-center gap-3 text-sm hover:bg-muted">
              {l.status === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              )}
              <Badge variant="outline" className="text-xs shrink-0">
                {l.tool_name ?? "—"}
              </Badge>
              {l.platform && (
                <span className={`text-[10px] font-medium uppercase tracking-wide rounded-full border px-1.5 py-0.5 shrink-0 ${PLATFORM_BADGE[l.platform] ?? "bg-muted text-muted-foreground border-border"}`}>
                  {l.platform}
                </span>
              )}
              <span className="text-muted-foreground truncate flex-1">
                {l.phone_number && <span className="text-muted-foreground">{l.phone_number}</span>}
                {l.error_message && (
                  <span className="ml-2 text-destructive truncate">— {l.error_message}</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{l.execution_time_ms}ms</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(l.created_at).toLocaleString()}
              </span>
            </div>
          ))}
      </div>
    </Card>
  );
}
