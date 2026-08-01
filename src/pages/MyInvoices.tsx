import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { InvoiceDetailDrawer } from '@/components/members/InvoiceDetailDrawer';
import { FileText, AlertCircle, Loader2, CheckCircle, Eye, CreditCard } from 'lucide-react';
import { format } from 'date-fns';
import { paymentChannelLabel } from '@/lib/payments/paymentDisplay';

export default function MyInvoices() {
  const navigate = useNavigate();
  const { member, isLoading: memberLoading } = useMemberData();
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Fetch all invoices for member
  const { data: invoices = [], isLoading: invoicesLoading, refetch } = useQuery({
    queryKey: ['member-invoices', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          items:invoice_items(*)
        `)
        .eq('member_id', member!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['my-payment-history', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, payment_method, payment_source, payment_date, status, transaction_id, invoices(invoice_number)')
        .eq('member_id', member?.id)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const handleViewInvoice = (invoice: any) => {
    setSelectedInvoice(invoice);
    setDetailOpen(true);
  };

  const handlePayNow = (invoice: any) => {
    setDetailOpen(false);
    // Route to the unified embedded checkout page (Razorpay Standard Checkout
    // modal in-page, no full-page redirect).
    navigate(`/member/pay?invoice=${invoice.id}`);
  };

  if (memberLoading || invoicesLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const pendingInvoices = invoices.filter(inv => ['pending', 'partial', 'overdue'].includes(inv.status));
  const paidInvoices = invoices.filter(inv => inv.status === 'paid');
  const totalPending = pendingInvoices.reduce((sum, inv) => sum + (inv.total_amount - (inv.amount_paid || 0)), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge variant="default" className="bg-success"><CheckCircle className="h-3 w-3 mr-1" />Paid</Badge>;
      case 'pending':
        return <Badge variant="destructive">Pending</Badge>;
      case 'partial':
        return <Badge variant="secondary">Partial</Badge>;
      case 'overdue':
        return <Badge variant="destructive">Overdue</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Invoices</h1>
          <p className="text-muted-foreground">View and pay your invoices</p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-destructive/10">
                  <FileText className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Amount</p>
                  <p className="text-2xl font-bold">₹{totalPending.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-warning/10">
                  <FileText className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Invoices</p>
                  <p className="text-2xl font-bold">{pendingInvoices.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-success/10">
                  <CheckCircle className="h-6 w-6 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Paid Invoices</p>
                  <p className="text-2xl font-bold">{paidInvoices.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invoices Table */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>All Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No invoices found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    const amountDue = invoice.total_amount - (invoice.amount_paid || 0);
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                        <TableCell>{format(new Date(invoice.created_at), 'dd MMM yyyy')}</TableCell>
                        <TableCell>₹{invoice.total_amount.toLocaleString()}</TableCell>
                        <TableCell>₹{(invoice.amount_paid || 0).toLocaleString()}</TableCell>
                        <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewInvoice(invoice)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            {['pending', 'partial', 'overdue'].includes(invoice.status) && amountDue > 0 && (
                              <Button
                                size="sm"
                                onClick={() => handlePayNow(invoice)}
                              >
                                <CreditCard className="h-4 w-4 mr-1" />
                                Pay
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
          <CardContent>
            {payments.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded yet</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Paid on</TableHead><TableHead>Invoice</TableHead><TableHead>Channel</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>{payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{format(new Date(payment.payment_date), 'dd MMM yyyy')}</TableCell>
                    <TableCell>{payment.invoices?.invoice_number || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{paymentChannelLabel(payment)}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{payment.transaction_id || '—'}</TableCell>
                    <TableCell className="text-right font-medium">₹{Number(payment.amount).toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onPayNow={handlePayNow}
      />
    </AppLayout>
  );
}
