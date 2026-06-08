import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  created_at: string;
  source: string | null;
  error_message: string;
  occurrence_count: number | null;
  context: any;
}

const INTEGRITY_KEYWORDS = [
  "violates check constraint",
  "violates foreign key",
  "violates not-null",
  "violates unique constraint",
  "permission denied",
  "23514",
  "23503",
  "23505",
  "23502",
  "42501",
];

/**
 * DB Integrity — last 24h.
 * Surfaces edge_function / database / trigger errors whose message looks like
 * a Postgres constraint or permission failure. Catches things like the
 * /register `pending_plan` constraint break before users open a ticket.
 */
export function DbIntegrityCard() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["db-integrity-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("error_logs")
        .select("id, created_at, source, error_message, occurrence_count, context")
        .in("source", ["edge_function", "database", "trigger"])
        .eq("severity", "error")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as Row[]).filter((r) => {
        const msg = (r.error_message || "").toLowerCase();
        return INTEGRITY_KEYWORDS.some((k) => msg.includes(k));
      });
    },
    refetchInterval: 60_000,
  });

  const total = data.reduce((n, r) => n + (r.occurrence_count ?? 1), 0);
  const healthy = data.length === 0;

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-primary" />
          DB Integrity — last 24h
          {healthy ? (
            <Badge variant="outline" className="ml-auto gap-1 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3" /> Healthy
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto gap-1 text-destructive border-destructive/30">
              <AlertTriangle className="h-3 w-3" /> {total} failures
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : healthy ? (
          <div className="text-xs text-muted-foreground">
            No constraint, FK, or permission failures in the last 24 hours.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-auto">
            {data.slice(0, 8).map((r) => (
              <div key={r.id} className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium uppercase text-[10px] tracking-wider text-muted-foreground">
                    {r.source}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px]">
                  {r.error_message}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
