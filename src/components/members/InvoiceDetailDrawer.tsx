import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { FileText, Download, CreditCard, CheckCircle, Clock, XCircle, FlaskConical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { signLabReport } from '@/services/batchService';
import { toast } from 'sonner';

interface InvoiceDetailDrawerProps {
  invoice: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPayNow?: (invoice: any) => void;
}

export function InvoiceDetailDrawer({ invoice, open, onOpenChange, onPayNow }: InvoiceDetailDrawerProps) {
  // Look up batch info + lab report paths for this invoice (POS sales only).
  const { data: batchLines = [] } = useQuery({
    queryKey: ['invoice-batches', invoice?.id],
    enabled: !!invoice?.id && open,
    queryFn: async () => {
      const { data: sale } = await (supabase as any)
        .from('pos_sales')
        .select('items')
        .eq('invoice_id', invoice.id)
        .maybeSingle();
      const items = Array.isArray(sale?.items) ? sale.items : [];
      const batchIds: string[] = [];
      for (const it of items) {
        if (Array.isArray(it.batches)) for (const b of it.batches) if (b.batch_id) batchIds.push(b.batch_id);
      }
      if (batchIds.length === 0) return [];
      const { data: batches } = await (supabase as any)
        .from('product_batches')
        .select('id, batch_number, exp_date, lab_report_url, lab_report_filename, products(name)')
        .in('id', batchIds);
      return batches || [];
    },
  });

  const [downloading, setDownloading] = useState(false);

  const handleDownloadInvoice = async () => {
    if (!invoice?.id) return;
    setDownloading(true);
    try {
      const { generateInvoicePdfBlob } = await import('@/utils/invoicePdf');
      const blob = await generateInvoicePdfBlob(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number || 'invoice'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate the invoice PDF');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadLab = async (path: string, filename: string | null) => {
    const url = await signLabReport(path, 60);
    if (!url) { toast.error('Lab report unavailable'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    if (filename) a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  };


  if (!invoice) return null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge variant="default" className="bg-success"><CheckCircle className="h-3 w-3 mr-1" />Paid</Badge>;
      case 'pending':
        return <Badge variant="destructive"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'partial':
        return <Badge variant="secondary">Partial</Badge>;
      case 'overdue':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Overdue</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const amountDue = invoice.total_amount - (invoice.amount_paid || 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoice Details
          </SheetTitle>
          <SheetDescription>
            {invoice.invoice_number}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Invoice Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Invoice Date</p>
              <p className="font-medium">{format(new Date(invoice.created_at), 'dd MMM yyyy')}</p>
            </div>
            {getStatusBadge(invoice.status)}
          </div>

          {invoice.due_date && (
            <div>
              <p className="text-sm text-muted-foreground">Due Date</p>
              <p className="font-medium">{format(new Date(invoice.due_date), 'dd MMM yyyy')}</p>
            </div>
          )}

          <Separator />

          {/* Invoice Items */}
          <div>
            <h4 className="font-semibold mb-3">Items</h4>
            {invoice.items && invoice.items.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity || 1}</TableCell>
                      <TableCell className="text-right">₹{item.unit_price?.toLocaleString()}</TableCell>
                      <TableCell className="text-right">₹{item.total_amount?.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No item details available</p>
            )}
          </div>

          {batchLines.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-success" />
                  Batch & Lab Reports
                </h4>
                <div className="space-y-2">
                  {batchLines.map((b: any) => (
                    <div key={b.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{b.products?.name || 'Product'}</p>
                        <p className="text-xs text-muted-foreground">
                          Batch {b.batch_number}{b.exp_date ? ` · EXP ${format(new Date(b.exp_date), 'MMM yyyy')}` : ''}
                        </p>
                      </div>
                      {b.lab_report_url ? (
                        <Button size="sm" variant="outline" onClick={() => handleDownloadLab(b.lab_report_url, b.lab_report_filename)}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Lab report
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">On request</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Totals */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>₹{invoice.subtotal?.toLocaleString()}</span>
            </div>
            {invoice.tax_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>₹{invoice.tax_amount?.toLocaleString()}</span>
              </div>
            )}
            {invoice.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-success">
                <span>Discount</span>
                <span>-₹{invoice.discount_amount?.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total</span>
              <span>₹{invoice.total_amount?.toLocaleString()}</span>
            </div>
            {invoice.amount_paid > 0 && (
              <div className="flex justify-between text-sm text-success">
                <span>Amount Paid</span>
                <span>₹{invoice.amount_paid?.toLocaleString()}</span>
              </div>
            )}
            {amountDue > 0 && (
              <div className="flex justify-between font-bold text-destructive">
                <span>Amount Due</span>
                <span>₹{amountDue.toLocaleString()}</span>
              </div>
            )}
          </div>

          {invoice.notes && (
            <>
              <Separator />
              <div>
                <h4 className="font-semibold mb-2">Notes</h4>
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            {invoice.status === 'pending' && amountDue > 0 && onPayNow && (
              <Button 
                className="flex-1"
                onClick={() => onPayNow(invoice)}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Pay Now
              </Button>
            )}
            <Button 
              variant="outline" 
              className="flex-1"
              disabled={downloading}
              onClick={handleDownloadInvoice}
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? 'Preparing…' : 'Download'}
            </Button>

          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
