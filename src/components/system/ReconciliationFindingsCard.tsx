import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, FileText, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";

type FindingDetails = {
  delta?: number;
  actual?: number;
  recorded?: number;
  gross_paid?: number;
  reversed?: number;
  items_total?: number;
  subtotal?: number;
  tax_amount?: number;
  total_amount?: number;
  discount_amount?: number;
  effective_rate?: number;
  item_count?: number;
  // Dynamic fields from various findings
  invoice_id?: string;
  invoice_number?: string;
  amount_paid?: number;
  member_id?: string;
} | null;

type Finding = {
  id: string;
  run_date: string;
  kind: string;
  severity: string;
  reference_type: string | null;
  reference_id: string | null;
  details: FindingDetails;
  resolved_at: string | null;
  occurrence_count: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
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
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const num = (v: unknown) => Number(v ?? 0);

const KIND_LABELS: Record<string, { title: string; explain: (d: FindingDetails) => string }> = {
  invoice_drift: {
    title: "Payment ledger mismatch",
    explain: (d) =>
      d
        ? `Invoice records ${inr(num(d.recorded))} received, but the payment ledger nets to ${inr(
            num(d.actual),
          )} (${inr(num(d.gross_paid))} collected less ${inr(num(d.reversed))} refunded) — off by ${inr(
            Math.abs(num(d.delta)),
          )}.`
        : "Recorded amount paid does not match the payment ledger.",
  },
  invoice_items_drift: {
    title: "Line item mismatch",
    explain: (d) =>
      d
        ? `Line items sum to ${inr(num(d.items_total))}, which does not reconcile with the invoice (subtotal ${inr(
            num(d.subtotal),
          )}, discount ${inr(num(d.discount_amount))}, total ${inr(num(d.total_amount))}) — off by ${inr(
            Math.abs(num(d.delta)),
          )}.`
        : "Invoice total does not match the sum of its line items.",
  },
  invoice_tax_drift: {
    title: "GST mismatch",
    explain: (d) => {
      if (!d) return "Tax amount does not reconcile with the invoice.";
      const rate = num(d.effective_rate);
      const parts = [
        `Subtotal ${inr(num(d.subtotal))} + GST ${inr(num(d.tax_amount))} should equal ${inr(num(d.total_amount))}`,
      ];
      if (Math.abs(num(d.delta)) > 0.05) parts.push(`off by ${inr(Math.abs(num(d.delta)))}`);
      if (rate && Math.abs(rate - 5) > 0.3) parts.push(`effective rate is ${rate}% instead of 5%`);
      return `${parts.join(" — ")}.`;
    },
  },
  wallet_drift: {
    title: "Wallet balance mismatch",
    explain: (d) =>
      d
        ? `Wallet records ${inr(num(d.recorded))} but transactions sum to ${inr(num(d.actual))} (off by ${inr(
            Math.abs(num(d.delta)),
          )}).`
        : "Wallet balance does not match its transaction ledger.",
  },
  payment_drift: {
    title: "Payment total mismatch",
    explain: (d) =>
      d
        ? `Recorded payments ${inr(num(d.recorded))} vs actual ${inr(num(d.actual))}.`
        : "Payment ledger does not match invoice paid amount.",
  },
  stalled_membership_activation: {
    title: "Stalled membership activation",
    explain: (d) =>
      d
        ? `Membership is still "Pending" despite having ${inr(num(d.amount_paid))} paid against invoice ${d.invoice_number || '—'}. Activate it to resume billing.`
        : "A payment was received for this membership, but it hasn't been activated yet.",
  },
};

export function ReconciliationFindingsCard() {
  const queryClient = useQueryClient();
  const [rechecking, setRechecking] = useState<string | null>(null);

  const { data: findings, isLoading } = useQuery({
    queryKey: ["reconciliation-findings"],
    queryFn: async (): Promise<Finding[]> => {
      const { data, error } = await supabase
        .from("reconciliation_findings")
        .select(
          "id, run_date, kind, severity, reference_type, reference_id, details, resolved_at, occurrence_count, first_seen_at, last_seen_at",
        )
        .is("resolved_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Finding[];
    },
    refetchInterval: 60_000,
  });

  // Live updates — findings clear themselves as soon as an invoice is corrected
  useEffect(() => {
    const channel = supabase
      .channel("reconciliation-findings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reconciliation_findings" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["reconciliation-findings"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const open = findings ?? [];

  const invoiceIds = open
    .filter((f) => (f.reference_type === "invoice" || f.details?.invoice_id) && (f.reference_id || f.details?.invoice_id))
    .map((f) => (f.reference_id || f.details?.invoice_id)!) as string[];

  const memberIds = open
    .filter((f) => (f.reference_type === "membership" || f.details?.member_id) && (f.reference_id || f.details?.member_id))
    .map((f) => (f.details?.member_id || f.reference_id)!) as string[];

  const { data: invoices } = useQuery({
    queryKey: ["reconciliation-finding-invoices", [...new Set(invoiceIds)].sort().join(",")],
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

  const { data: profiles } = useQuery({
    queryKey: ["reconciliation-finding-profiles", [...new Set(memberIds)].sort().join(",")],
    enabled: memberIds.length > 0,
    queryFn: async (): Promise<Record<string, { id: string; full_name: string }>> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberIds);
      if (error) throw error;
      const map: Record<string, { id: string; full_name: string }> = {};
      for (const p of data ?? []) map[p.id] = p;
      return map;
    },
  });

  const handleRecheck = async (finding: Finding) => {
    if (finding.reference_type !== "invoice" || !finding.reference_id) return;
    setRechecking(finding.id);
    try {
      const { error } = await supabase.rpc("recheck_invoice_reconciliation", {
        p_invoice_id: finding.reference_id,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["reconciliation-findings"] });
      toast.success("Re-checked against the live ledger");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-check failed");
    } finally {
      setRechecking(null);
    }
  };

  const totalOpen = open.length;

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
            Live ledger checks on payments, line items and GST. Findings clear themselves once corrected.
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
            {open.slice(0, 12).map((f) => {
              const meta = KIND_LABELS[f.kind] ?? {
                title: f.kind.replace(/_/g, " "),
                explain: () => "Discrepancy detected.",
              };
              const inv =
                f.reference_type === "invoice" && f.reference_id 
                  ? invoices?.[f.reference_id] 
                  : (f.kind === 'stalled_membership_activation' && f.details?.invoice_number ? { invoice_number: f.details.invoice_number } : undefined);
              
              const label =
                (inv as InvoiceLite)?.invoice_number ??
                (f.reference_type === 'membership' && f.reference_id ? 
                  (profiles?.[f.reference_id]?.full_name || `Member ${f.reference_id.slice(0, 8)}`) : 
                  f.reference_id ? `${f.reference_type} ${f.reference_id.slice(0, 8)}` : meta.title);

              const memberName = (inv as InvoiceLite)?.customer_name || 
                                (f.details?.member_id ? profiles?.[f.details.member_id]?.full_name : 
                                (f.reference_type === 'membership' ? profiles?.[f.reference_id!]?.full_name : null));
              
              const seen = f.first_seen_at ?? f.last_seen_at;
              return (
                <li key={f.id} className="rounded-xl bg-warning/10 ring-1 ring-warning/15 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-warning shrink-0" />
                        <span className="font-semibold text-foreground">{meta.title}</span>
                      </div>
                      <div className="text-foreground">{meta.explain(f.details)}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{label}</span>
                        {memberName && <span>· {memberName}</span>}
                        {(inv as InvoiceLite)?.status && <span>· {(inv as InvoiceLite).status}</span>}
                        {seen && <span>· first seen {format(new Date(seen), "d MMM")}</span>}
                        {(f.occurrence_count ?? 1) > 1 && <span>· seen {f.occurrence_count}×</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {f.last_seen_at && (
                        <Badge variant="outline" className="text-xs">
                          {format(new Date(f.last_seen_at), "d MMM HH:mm")}
                        </Badge>
                      )}
                      {f.reference_type === "invoice" && f.reference_id && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 cursor-pointer px-2 text-xs"
                            onClick={() => handleRecheck(f)}
                            disabled={rechecking === f.id}
                            aria-label="Re-check this finding"
                          >
                            <RefreshCw
                              className={`mr-1 h-3 w-3 ${rechecking === f.id ? "animate-spin" : ""}`}
                            />
                            Re-check
                          </Button>
                          <Link
                            to={`/invoices?focus=${f.reference_id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </Link>
                        </>
                      )}
                      {f.kind === 'stalled_membership_activation' && f.details?.member_id && (
                         <Link
                            to={`/members?focus=${f.details.member_id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary"
                          >
                            View Member <ExternalLink className="h-3 w-3" />
                          </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {open.length > 12 && (
              <li className="text-center text-xs text-muted-foreground">
                +{open.length - 12} more findings
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
