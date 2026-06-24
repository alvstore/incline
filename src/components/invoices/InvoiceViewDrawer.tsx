import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { FileText, Printer, Download, IndianRupee, CreditCard, Link2, Receipt, Mail } from 'lucide-react';
import { InvoiceShareDrawer } from './InvoiceShareDrawer';
import { PaymentLinkTimeline } from './PaymentLinkTimeline';
import { buildInvoicePdf, buildThermalReceiptPdf, downloadBlob, printBlob } from '@/utils/pdfBlob';
import { useBrandContext } from '@/lib/brand/useBrandContext';
import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';

interface InvoiceViewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  onRecordPayment: () => void;
  onSendPaymentLink?: () => void;
}

export function InvoiceViewDrawer({ open, onOpenChange, invoiceId, onRecordPayment, onSendPaymentLink }: InvoiceViewDrawerProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const { data: brand } = useBrandContext(null);
  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice-details', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          members(member_code, profiles:user_id(full_name, email, phone), lead:lead_id(full_name, email, phone, avatar_url)),
          branch:branch_id(name, address, phone, email, gstin),
          invoice_items(*),
          pos_sales!invoices_pos_sale_id_fkey(items)
        `)
        .eq('id', invoiceId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId && open,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['invoice-payments', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId && open,
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      paid: 'bg-success/10 text-success',
      pending: 'bg-warning/10 text-warning',
      partial: 'bg-info/10 text-info',
      overdue: 'bg-destructive/10 text-destructive',
      cancelled: 'bg-muted text-muted-foreground',
    };
    return colors[status] || 'bg-muted';
  };

  const handlePrint = () => { window.print(); };

  const buildPDFData = () => {
    const memberDisplay = resolveMemberDisplay((invoice as any).members, invoice.customer_name);
    // Build a product_id → batches[] map from pos_sales.items (set by create_pos_sale RPC)
    const posItems: any[] = Array.isArray((invoice as any).pos_sales?.items)
      ? (invoice as any).pos_sales.items
      : Array.isArray((invoice as any).pos_sales?.[0]?.items)
        ? (invoice as any).pos_sales[0].items
        : [];
    const batchByProduct = new Map<string, any[]>();
    posItems.forEach((it: any) => {
      if (it?.product_id && Array.isArray(it.batches) && it.batches.length) {
        batchByProduct.set(String(it.product_id), it.batches);
      }
    });
    return {
      invoice_number: invoice.invoice_number,
      created_at: invoice.created_at,
      due_date: invoice.due_date,
      status: invoice.status,
      subtotal: invoice.subtotal || invoice.total_amount,
      discount_amount: invoice.discount_amount || 0,
      tax_amount: invoice.tax_amount || 0,
      total_amount: invoice.total_amount,
      amount_paid: invoice.amount_paid || 0,
      notes: invoice.notes,
      items: (invoice.invoice_items || []).map((i: any) => ({
        description: i.description, quantity: i.quantity || 1,
        unit_price: i.unit_price, total_amount: i.total_amount,
        batches: i.reference_id ? batchByProduct.get(String(i.reference_id)) : undefined,
      })),
      member_name: memberDisplay.name,
      member_code: memberDisplay.code,
      member_email: memberDisplay.email || invoice.customer_email,
      member_phone: memberDisplay.phone || invoice.customer_phone,
      branch_name: invoice.branch?.name || '',
      branch_address: invoice.branch?.address,
      branch_phone: invoice.branch?.phone,
      branch_email: invoice.branch?.email,
      gst_number: invoice.branch?.gstin,
      is_gst_invoice: invoice.is_gst_invoice || false,
      gst_rate: invoice.gst_rate || 0,
      customer_gstin: invoice.customer_gstin,
    };
  };

  const handleDownloadPDF = () => {
    if (!invoice) return;
    const blob = buildInvoicePdf(buildPDFData(), brand);
    downloadBlob(blob, `Invoice-${invoice.invoice_number}.pdf`);
  };
  const handleThermalPrint = () => {
    if (!invoice) return;
    printBlob(buildThermalReceiptPdf(buildPDFData(), brand));
  };

  if (isLoading || !invoice) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Loading Invoice</SheetTitle>
          </SheetHeader>
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const memberProfile = (invoice.members as any)?.profiles;
  const dueAmount = invoice.total_amount - (invoice.amount_paid || 0);

  // Derive Wallet Used vs Other Payment from payments table (fallback to notes regex)
  const walletPaid = payments
    .filter((p: any) => (p.payment_method || '').toLowerCase() === 'wallet' && (p.status || 'completed') === 'completed')
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const otherPaid = payments
    .filter((p: any) => (p.payment_method || '').toLowerCase() !== 'wallet' && (p.status || 'completed') === 'completed')
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const notesWalletMatch = !walletPaid && invoice.notes
    ? String(invoice.notes).match(/Wallet applied:\s*₹?\s*([\d.,]+)/i)
    : null;
  const walletDisplay = walletPaid || (notesWalletMatch ? Number(notesWalletMatch[1].replace(/,/g, '')) : 0);
  const isRefund = (invoice.total_amount || 0) < 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoice Details
            </SheetTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={handleDownloadPDF} title="Download PDF">
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={handleThermalPrint} title="Print Thermal Receipt">
                <Receipt className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={handlePrint} title="Print">
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6 print:space-y-4">
          {/* Invoice Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold font-mono">{invoice.invoice_number}</h2>
              {invoice.is_gst_invoice && (
                <Badge className="bg-primary/10 text-primary mt-1">TAX INVOICE</Badge>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                Date: {format(new Date(invoice.created_at), 'dd MMM yyyy')}
              </p>
              {invoice.due_date && (
                <p className="text-sm text-muted-foreground">
                  Due: {format(new Date(invoice.due_date), 'dd MMM yyyy')}
                </p>
              )}
            </div>
            <Badge className={`${getStatusColor(invoice.status)} text-sm px-3 py-1`}>
              {invoice.status}
            </Badge>
          </div>

          <Separator />

          {/* Bill To / From */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">From</p>
                <p className="font-medium">{invoice.branch?.name}</p>
                <p className="text-sm text-muted-foreground">{invoice.branch?.address}</p>
                <p className="text-sm text-muted-foreground">{invoice.branch?.phone}</p>
                {invoice.branch?.gstin && (
                  <p className="text-xs font-mono text-muted-foreground mt-1">GSTIN: {invoice.branch.gstin}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Bill To</p>
                <p className="font-medium">{memberProfile?.full_name || invoice.customer_name || 'Walk-in Customer'}</p>
                <p className="text-sm text-muted-foreground">{memberProfile?.email || invoice.customer_email}</p>
                <p className="text-sm text-muted-foreground">{memberProfile?.phone || invoice.customer_phone}</p>
                {invoice.members?.member_code && (
                  <p className="text-xs font-mono text-muted-foreground mt-1">{invoice.members.member_code}</p>
                )}
                {invoice.customer_gstin && (
                  <p className="text-xs font-mono text-muted-foreground">GSTIN: {invoice.customer_gstin}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Line Items */}
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.invoice_items?.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity || 1}</TableCell>
                      <TableCell className="text-right">₹{item.unit_price.toLocaleString()}</TableCell>
                      <TableCell className="text-right">₹{item.total_amount.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Totals */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payment Summary</span>
                <Badge className={`${getStatusColor(invoice.status)} border capitalize`}>{invoice.status}</Badge>
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>₹{Number(invoice.subtotal || 0).toLocaleString()}</span>
              </div>
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount</span>
                  <span>-₹{Number(invoice.discount_amount).toLocaleString()}</span>
                </div>
              )}
              {invoice.tax_amount > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">CGST{invoice.gst_rate ? ` (${invoice.gst_rate / 2}%)` : ''}</span>
                    <span>₹{(invoice.tax_amount / 2).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SGST{invoice.gst_rate ? ` (${invoice.gst_rate / 2}%)` : ''}</span>
                    <span>₹{(invoice.tax_amount / 2).toLocaleString()}</span>
                  </div>
                </>
              )}
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="flex items-center">
                  <IndianRupee className="h-4 w-4" />
                  {Math.abs(invoice.total_amount).toLocaleString()}
                  {isRefund && <span className="ml-2 text-xs text-destructive">(Refund)</span>}
                </span>
              </div>

              {walletDisplay > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    Wallet Used
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Wallet</Badge>
                  </span>
                  <span className="text-info dark:text-info">-₹{walletDisplay.toLocaleString()}</span>
                </div>
              )}
              {otherPaid > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cash / Card / UPI</span>
                  <span>₹{otherPaid.toLocaleString()}</span>
                </div>
              )}
              {invoice.amount_paid > 0 && (
                <div className="flex justify-between text-success font-medium">
                  <span>Total Paid</span>
                  <span>₹{Number(invoice.amount_paid).toLocaleString()}</span>
                </div>
              )}
              {dueAmount > 0 ? (
                <div className="flex justify-between text-destructive font-semibold">
                  <span>Remaining Balance</span>
                  <span>₹{dueAmount.toLocaleString()}</span>
                </div>
              ) : !isRefund && invoice.status !== 'cancelled' ? (
                <div className="flex justify-between text-success text-xs">
                  <span>Remaining Balance</span>
                  <span>Settled</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Payment Link / Gateway Timeline */}
          <PaymentLinkTimeline invoiceId={invoice.id} />

          {/* Payment History */}
          {payments.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-medium mb-3">Payment History</h4>
                <div className="space-y-2">
                  {payments.map((payment: any) => (
                    <div key={payment.id} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <span className="capitalize">{payment.payment_method}</span>
                        <span className="text-muted-foreground">
                          • {format(new Date(payment.payment_date), 'dd MMM yyyy')}
                        </span>
                      </div>
                      <span className="font-medium text-success">₹{payment.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {invoice.notes && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          {dueAmount > 0 && (
            <div className="space-y-2">
              <Button className="w-full" onClick={() => { onOpenChange(false); onRecordPayment(); }}>
                <CreditCard className="h-4 w-4 mr-2" />
                Record Payment (₹{dueAmount.toLocaleString()} due)
              </Button>
              <Button variant="outline" className="w-full" onClick={() => { onOpenChange(false); onSendPaymentLink?.(); }}>
                <Link2 className="h-4 w-4 mr-2" />
                Send Payment Link
              </Button>
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={() => setShareOpen(true)}>
            <Mail className="h-4 w-4 mr-2" />
            Share Invoice
          </Button>
        </div>

        <InvoiceShareDrawer
          open={shareOpen}
          onOpenChange={setShareOpen}
          invoice={invoice}
        />
      </SheetContent>
    </Sheet>
  );
}
