import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

type Finding = {
  id: string;
  run_date: string;
  kind: string;
  severity: string;
  reference_type: string | null;
  reference_id: string | null;
  details: { delta?: number; actual?: number; recorded?: number } | null;
  resolved_at: string | null;
};

type InvoiceLite = {
  id: string;
  invoice_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_amount: number | null;
  amount_paid: number | null;
  status: string | null;
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const KIND_LABELS: Record<string, { title: string; explain: (d: Finding["details"]) => string }> = {
  invoice_drift: {
    title: "Invoice total mismatch",
    explain: (d) =>
      d
        ? `Invoice records ${inr(Number(d.recorded ?? 0))} but linked items sum to ${inr(
            Number(d.actual ?? 0),
          )} (off by ${inr(Math.abs(Number(d.delta ?? 0)))}).`
        : "Recorded total does not match the sum of line items.",
  },
  payment_drift: {
    title: "Payment total mismatch",
    explain: (d) =>
      d
        ? `Recorded payments ${inr(Number(d.recorded ?? 0))} vs actual ${inr(Number(d.actual ?? 0))}.`
        : "Payment ledger does not match invoice paid amount.",
  },
};

export function ReconciliationFindingsCard() {
  const { data: findings, isLoading } = useQuery({
    queryKey: ["reconciliation-findings"],
    queryFn: async (): Promise<Finding[]> => {
      const { data, error } = await supabase
        .from("reconciliation_findings")
        .select("id, run_date, kind, severity, reference_type, reference_id, details, resolved_at")
        .is("resolved_at", null)
        .order("run_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
    refetchInterval: 60_000,
  });

  // Group by reference (e.g. same invoice repeated daily)
  const grouped = (() => {
    const map = new Map<string, { latest: Finding; count: number; firstSeen: string }>();
    for (const f of findings ?? []) {
      const key = `${f.kind}:${f.reference_type}:${f.reference_id}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { latest: f, count: 1, firstSeen: f.run_date });
      } else {
        existing.count += 1;
        if (f.run_date < existing.firstSeen) existing.firstSeen = f.run_date;
      }
    }
    return Array.from(map.values());
  })();

  const invoiceIds = grouped
    .filter((g) => g.latest.reference_type === "invoice" && g.latest.reference_id)
    .map((g) => g.latest.reference_id!) as string[];

  const { data: invoices } = useQuery({
    queryKey: ["reconciliation-finding-invoices", invoiceIds.sort().join(",")],
    enabled: invoiceIds.length > 0,
    queryFn: async (): Promise<Record<string, InvoiceLite>> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, customer_phone, total_amount, amount_paid, status")
        .in("id", invoiceIds);
      if (error) throw error;
      const map: Record<string, InvoiceLite> = {};
      for (const inv of data ?? []) map[inv.id] = inv as InvoiceLite;
      return map;
    },
  });

  const totalOpen = grouped.length;

  return (
    <Card className="rounded-2xl shadow-lg shadow/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {totalOpen === 0 ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-warning" />
            )}
            Reconciliation findings
          </span>
          <Badge variant={totalOpen === 0 ? "secondary" : "destructive"}>
            {isLoading ? "…" : `${totalOpen} open`}
          </Badge>
        </CardTitle>
        {totalOpen > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            Issues detected by the daily ledger reconciliation. Repeats per day are grouped.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : totalOpen === 0 ? (
          <p className="text-sm text-success">All ledgers reconciled.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {grouped.slice(0, 12).map((g) => {
              const f = g.latest;
              const meta = KIND_LABELS[f.kind] ?? {
                title: f.kind.replace(/_/g, " "),
                explain: () => "Discrepancy detected.",
              };
              const inv =
                f.reference_type === "invoice" && f.reference_id ? invoices?.[f.reference_id] : undefined;
              const label =
                inv?.invoice_number ?? (f.reference_id ? `${f.reference_type} ${f.reference_id.slice(0, 8)}` : meta.title);
              return (
                <li
                  key={g.latest.id}
                  className="rounded-xl bg-warning/10 ring-1 ring-warning/15 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-warning shrink-0" />
                        <span className="font-semibold text-foreground">{meta.title}</span>
                      </div>
                      <div className="text-foreground">{meta.explain(f.details)}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{label}</span>
                        {inv?.customer_name && <span>· {inv.customer_name}</span>}
                        {inv?.status && <span>· {inv.status}</span>}
                        <span>· first seen {format(new Date(g.firstSeen), "d MMM")}</span>
                        {g.count > 1 && <span>· repeated {g.count}×</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs">
                        {f.run_date}
                      </Badge>
                      {f.reference_type === "invoice" && f.reference_id && (
                        <Link
                          to={`/invoices?focus=${f.reference_id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary"
                        >
                          Open <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {grouped.length > 12 && (
              <li className="text-center text-xs text-muted-foreground">
                +{grouped.length - 12} more findings
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
