import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SlaRow {
  id: string;
  created_at: string;
  error_message: string;
  context: any;
  occurrence_count?: number | null;
}

/**
 * AI Reply SLA — last 24h.
 * Reads error_logs (source='ai_lead_loss', severity='warning') written by
 * the `monitor-ai-lead-loss` cron when an inbound message goes >5 min without
 * an outbound reply while the bot is active. Empty list = green / healthy.
 */
export function AiReplySlaCard() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["ai-reply-sla-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("error_logs")
        .select("id, created_at, error_message, context, occurrence_count")
        .eq("source", "ai_lead_loss")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as SlaRow[];
    },
    refetchInterval: 60_000,
  });

  const totalIncidents = data.reduce((n, r) => n + (r.occurrence_count ?? 1), 0);
  const uniqueContacts = new Set(
    data.map((r) => r?.context?.phone || r?.context?.contact || r.id),
  ).size;
  const healthy = data.length === 0;

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-primary" />
          AI Reply SLA — last 24h
          {healthy ? (
            <Badge variant="outline" className="ml-auto gap-1 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3" /> Healthy
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto gap-1 text-warning border-warning/30">
              <AlertTriangle className="h-3 w-3" /> {uniqueContacts} at risk
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-bold">{totalIncidents}</div>
            <div className="text-xs text-muted-foreground">Stalled threads</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{uniqueContacts}</div>
            <div className="text-xs text-muted-foreground">Unique contacts</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{healthy ? "100%" : `${Math.max(0, 100 - uniqueContacts * 2)}%`}</div>
            <div className="text-xs text-muted-foreground">Reply SLA</div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : healthy ? (
          <div className="text-xs text-muted-foreground">
            No stalled AI threads. Every inbound got a reply within 5 minutes.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {data.slice(0, 6).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between text-xs rounded-lg bg-muted/40 px-2.5 py-1.5"
              >
                <span className="font-mono truncate">
                  {r?.context?.phone || r?.context?.contact_key || "unknown"}
                </span>
                <span className="text-muted-foreground">
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
