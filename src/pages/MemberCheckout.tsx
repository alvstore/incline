import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GymLoader } from '@/components/ui/gym-loader';
import { CheckCircle, CreditCard, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useNoindex } from '@/lib/seo/useNoindex';
import {
  initializePayment,
  openRazorpayCheckout,
  verifyRazorpayPayment,
  type PaymentOrder,
} from '@/services/paymentService';
import { useAuth } from '@/contexts/AuthContext';

interface InvoiceInfo {
  id: string;
  invoice_number: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  due_date: string | null;
  branch_id: string;
  member_id: string | null;
  member_name: string;
  member_phone: string;
  member_email: string;
  branch_name: string;
}

/**
 * Unified embedded checkout page.
 *
 * Used by:
 *   • /member/pay?invoice=...                 (public payment link)
 *   • Member Store after creating a pending invoice
 *   • My Invoices "Pay" action (authenticated)
 *   • Membership purchase (pending invoice)
 *
 * Razorpay opens as an in-page Standard Checkout modal (their official
 * “embedded” experience — no full-page redirect). On success the handler
 * response is verified server-side by the verify-payment edge function,
 * which calls the authoritative settle_payment RPC. A realtime subscription
 * also reflects async webhook confirmations.
 */
export default function MemberCheckout() {
  useNoindex('Checkout | The Incline Life');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const invoiceId = searchParams.get('invoice');

  const [invoice, setInvoice] = useState<InvoiceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchInvoice = useCallback(async () => {
    if (!invoiceId) {
      setError('No invoice specified.');
      setLoading(false);
      return;
    }
    try {
      const { data, error: fetchErr } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, total_amount, amount_paid, status, due_date, branch_id, member_id,
          members!invoices_member_id_fkey ( user_id ),
          branches!invoices_branch_id_fkey ( name )
        `)
        .eq('id', invoiceId)
        .maybeSingle();

      if (fetchErr || !data) {
        setError('Invoice not found.');
        setLoading(false);
        return;
      }

      let memberName = 'Member';
      let memberPhone = '';
      let memberEmail = '';
      const member = data.members as any;
      if (member?.user_id) {
        const { data: p } = await supabase
          .from('profiles')
          .select('full_name, phone, email')
          .eq('id', member.user_id)
          .maybeSingle();
        if (p) {
          memberName = p.full_name || memberName;
          memberPhone = p.phone || '';
          memberEmail = p.email || '';
        }
      }

      setInvoice({
        id: data.id,
        invoice_number: data.invoice_number || 'N/A',
        total_amount: Number(data.total_amount),
        amount_paid: Number(data.amount_paid || 0),
        status: data.status || 'pending',
        due_date: data.due_date,
        branch_id: data.branch_id,
        member_id: data.member_id,
        member_name: memberName,
        member_phone: memberPhone,
        member_email: memberEmail,
        branch_name: (data.branches as any)?.name || 'Incline Fitness',
      });
    } catch {
      setError('Failed to load invoice.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  // Auto-open the embedded Razorpay modal as soon as the invoice loads.
  // Behaves like an inline iframe — no extra tap required.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!autoOpened && invoice && !loading && invoice.status !== 'paid' && (invoice.total_amount - invoice.amount_paid) > 0) {
      setAutoOpened(true);
      // small delay so the page paints first
      const t = setTimeout(() => { startPayment(); }, 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, loading]);

  // Realtime confirmation when webhook settles in the background
  useEffect(() => {
    if (!invoiceId) return;
    const channel = supabase
      .channel(`checkout-${invoiceId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'invoices',
        filter: `id=eq.${invoiceId}`,
      }, (payload: any) => {
        if (payload.new) {
          setInvoice((prev) => prev ? {
            ...prev,
            status: payload.new.status,
            amount_paid: Number(payload.new.amount_paid || 0),
          } : prev);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [invoiceId]);

  const balanceDue = invoice ? Math.max(0, invoice.total_amount - invoice.amount_paid) : 0;
  const isPaid = invoice ? (invoice.status === 'paid' || balanceDue <= 0) : false;

  const startPayment = async () => {
    if (!invoice) return;
    setError(null);
    setSubmitting(true);
    let order: PaymentOrder | null = null;
    try {
      order = await initializePayment(invoice.id, invoice.branch_id);
    } catch (err: any) {
      setSubmitting(false);
      const code = err?.code || '';
      if (code === 'NO_GATEWAY' || code === 'GATEWAY_NOT_IMPLEMENTED') {
        setError(err.message || 'Online payments are not configured for this branch yet.');
      } else {
        setError(err.message || 'Failed to start payment.');
      }
      return;
    }

    if (!order || order.gateway !== 'razorpay' || !order.gatewayOrderId) {
      setSubmitting(false);
      setError('This branch is configured with a gateway that does not yet support embedded checkout.');
      return;
    }

    await openRazorpayCheckout(
      order,
      {
        name: invoice.member_name || profile?.full_name || 'Member',
        email: invoice.member_email || profile?.email || '',
        phone: invoice.member_phone || profile?.phone || '',
      },
      async (resp) => {
        try {
          await verifyRazorpayPayment({
            invoiceId: invoice.id,
            branchId: invoice.branch_id,
            ...resp,
          });
          toast.success('Payment successful!');
          await fetchInvoice();
        } catch (err: any) {
          toast.error(err.message || 'Payment verification failed');
          setError(err.message || 'Payment verification failed');
        } finally {
          setSubmitting(false);
        }
      },
      (err) => {
        if (err.message !== 'Payment cancelled') {
          toast.error(err.message || 'Payment failed');
          setError(err.message);
        }
        setSubmitting(false);
      },
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <GymLoader text="Loading invoice..." />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <Card className="max-w-md w-full rounded-2xl shadow-xl">
          <CardContent className="flex flex-col items-center py-10 gap-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h2 className="text-lg font-semibold">Payment Error</h2>
            <p className="text-muted-foreground text-center text-sm">{error || 'Invoice unavailable.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="max-w-md w-full rounded-2xl overflow-hidden shadow-xl shadow-slate-200/50">
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-5">
          <h1 className="text-xl font-bold">Incline Fitness</h1>
          <p className="text-orange-100 text-sm">{invoice.branch_name}</p>
        </div>

        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Invoice {invoice.invoice_number}</CardTitle>
            <Badge variant={isPaid ? 'default' : 'secondary'} className={isPaid ? 'bg-green-500 text-white' : ''}>
              {isPaid ? (
                <><CheckCircle className="h-3 w-3 mr-1" /> Paid</>
              ) : (
                <><Clock className="h-3 w-3 mr-1" /> Pending</>
              )}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{invoice.member_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Amount</span>
              <span className="font-medium">₹{invoice.total_amount.toLocaleString()}</span>
            </div>
            {invoice.amount_paid > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Paid</span>
                <span className="font-medium text-green-600">₹{invoice.amount_paid.toLocaleString()}</span>
              </div>
            )}
            {!isPaid && (
              <div className="flex justify-between border-t pt-2">
                <span className="font-semibold">Balance Due</span>
                <span className="font-bold text-lg">₹{balanceDue.toLocaleString()}</span>
              </div>
            )}
            {invoice.due_date && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due Date</span>
                <span>{new Date(invoice.due_date).toLocaleDateString('en-IN')}</span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isPaid ? (
            <div className="text-center py-4 space-y-3">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <h3 className="text-lg font-semibold text-green-700">Payment Received</h3>
              <p className="text-muted-foreground text-sm">Thank you! Your payment has been confirmed.</p>
              {profile && (
                <Button variant="outline" onClick={() => navigate('/my-invoices')}>
                  Back to My Invoices
                </Button>
              )}
            </div>
          ) : (
            <>
              <Button
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700"
                onClick={startPayment}
                disabled={submitting}
              >
                {submitting ? (
                  <>Processing…</>
                ) : (
                  <><CreditCard className="h-5 w-5 mr-2" /> Pay ₹{balanceDue.toLocaleString()} Securely</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                Secure payment powered by Razorpay. PCI-DSS compliant.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
