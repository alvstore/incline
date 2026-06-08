import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link2, ShieldCheck, ShieldX, ShieldAlert, ExternalLink, AlertCircle } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface PaymentTransactionRow {
  id: string;
  gateway: string;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  amount: number | null;
  status: string | null;
  signature_verified: boolean | null;
  http_status: number | null;
  error_message: string | null;
  event_type: string | null;
  source: string | null;
  received_at: string | null;
  created_at: string;
  payment_link_url: string | null;
  lifecycle_status: string | null;
}

const GATEWAY_LABEL: Record<string, string> = {
  razorpay: 'Razorpay', phonepe: 'PhonePe', payu: 'PayU', ccavenue: 'CCAvenue',
};

function statusColor(s: string | null): string {
  if (s === 'captured' || s === 'paid' || s === 'completed') return 'bg-success/10 text-success border-success/20';
  if (s === 'failed' || s === 'rejected' || s === 'expired') return 'bg-destructive/10 text-destructive border-destructive/20';
  if (s === 'authorized' || s === 'pending' || s === 'created' || s === 'awaiting_payment') return 'bg-warning/10 text-warning border-warning/20';
  return 'bg-info/10 text-info border-info/20';
}

function SignatureChip({ verified }: { verified: boolean | null }) {
  if (verified === true) return <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1 text-[10px]"><ShieldCheck className="h-2.5 w-2.5" />Verified</Badge>;
  if (verified === false) return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 text-[10px]"><ShieldX className="h-2.5 w-2.5" />Invalid</Badge>;
  return <Badge variant="outline" className="bg-muted text-muted-foreground gap-1 text-[10px]"><ShieldAlert className="h-2.5 w-2.5" />n/a</Badge>;
}

/**
 * Read-only timeline of every payment-gateway event recorded against an invoice:
 * link creation, webhook deliveries, signature outcomes, captures, failures.
 *
 * Data source: payment_transactions filtered by invoice_id, ordered chronologically.
 * Hidden when the invoice has had no gateway activity (manual/cash invoices).
 */
export function PaymentLinkTimeline({ invoiceId }: { invoiceId: string }) {
  const { data: rows = [], isLoading } = useQuery<PaymentTransactionRow[]>({
    queryKey: ['invoice-payment-timeline', invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('id, gateway, gateway_order_id, gateway_payment_id, amount, status, signature_verified, http_status, error_message, event_type, source, received_at, created_at, payment_link_url, lifecycle_status')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as PaymentTransactionRow[]) || [];
    },
    enabled: !!invoiceId,
  });

  if (isLoading || rows.length === 0) return null;

  const linkRow = rows.find(r => r.payment_link_url);
  const latest = rows[0];
  const latestStatus = latest.lifecycle_status || latest.status || 'pending';

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Payment Link Activity
          </h4>
          <Badge variant="outline" className={statusColor(latestStatus)}>
            {String(latestStatus).replace(/_/g, ' ')}
          </Badge>
        </div>

        {linkRow?.payment_link_url && (
          <a
            href={linkRow.payment_link_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{linkRow.payment_link_url}</span>
          </a>
        )}

        <div className="space-y-2">
          {rows.map((r) => {
            const isError = (r.http_status && r.http_status >= 400) || r.signature_verified === false || r.status === 'failed' || r.status === 'rejected';
            return (
              <div key={r.id} className="flex items-start gap-3 text-xs p-2 bg-muted/40 rounded-lg">
                <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                  r.status === 'captured' ? 'bg-success'
                    : isError ? 'bg-destructive'
                    : 'bg-warning'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`${statusColor(r.status)} text-[10px]`}>
                      {r.status || 'received'}
                    </Badge>
                    <span className="text-muted-foreground">{r.event_type || r.source || 'event'}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{GATEWAY_LABEL[r.gateway] || r.gateway}</span>
                    {r.source === 'webhook' && <SignatureChip verified={r.signature_verified} />}
                  </div>
                  {r.gateway_payment_id && (
                    <p className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                      pay_id: {r.gateway_payment_id}
                    </p>
                  )}
                  {r.error_message && (
                    <p className="text-destructive flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      {r.error_message}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {r.amount != null && <p className="font-medium">₹{Number(r.amount).toLocaleString()}</p>}
                  <p className="text-muted-foreground text-[10px]" title={format(new Date(r.received_at || r.created_at), 'PPpp')}>
                    {formatDistanceToNow(new Date(r.received_at || r.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
