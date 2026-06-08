import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";

interface Row {
  branch_id: string | null;
  hour: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  stuck_pending: number;
}

export function WhatsAppDeliveryHealthCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-delivery-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_delivery_health" as never)
        .select("*");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const totals = (data ?? []).reduce(
    (acc, r) => ({
      sent: acc.sent + Number(r.sent ?? 0),
      delivered: acc.delivered + Number(r.delivered ?? 0),
      read: acc.read + Number(r.read ?? 0),
      failed: acc.failed + Number(r.failed ?? 0),
      stuck: acc.stuck + Number(r.stuck_pending ?? 0),
    }),
    { sent: 0, delivered: 0, read: 0, failed: 0, stuck: 0 },
  );

  const deliveryRate =
    totals.sent === 0 ? 0 : Math.round((totals.delivered / totals.sent) * 100);

  return (
    <Card className="rounded-2xl shadow-lg shadow/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-5 w-5 text-primary" />
          WhatsApp delivery (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <Stat label="Sent" value={totals.sent} />
            <Stat label="Delivered" value={totals.delivered} accent="emerald" />
            <Stat label="Read" value={totals.read} accent="indigo" />
            <Stat label="Failed" value={totals.failed} accent="red" />
            <Stat label="Stuck" value={totals.stuck} accent="amber" />
            <div className="col-span-2 md:col-span-5 mt-2 text-xs text-muted-foreground">
              Delivery rate: <span className="font-semibold text-foreground">{deliveryRate}%</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: number;
  accent?: "slate" | "emerald" | "indigo" | "red" | "amber";
}) {
  const color = {
    slate: "text-foreground",
    emerald: "text-success",
    indigo: "text-primary",
    red: "text-destructive",
    amber: "text-warning",
  }[accent];
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
