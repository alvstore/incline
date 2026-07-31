import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, IndianRupee, Pencil, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { RecordPaymentDrawer } from '@/components/invoices/RecordPaymentDrawer';
import { CorrectInvoiceDrawer } from '@/components/invoices/CorrectInvoiceDrawer';
import { CancelInvoiceDrawer } from '@/components/invoices/CancelInvoiceDrawer';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  branchId: string;
}

const statusClass = (status: string) => {
  switch (status) {
    case 'paid':
      return 'bg-emerald-100 text-emerald-700';
    case 'partial':
      return 'bg-amber-100 text-amber-700';
    case 'overdue':
      return 'bg-red-100 text-red-700';
    case 'cancelled':
    case 'refunded':
      return 'bg-slate-200 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};

export function MemberInvoicesDrawer({ open, onOpenChange, memberId, branchId }: Props) {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const canAmend = can.cancelInvoice(roles.map((r) => r.role));
  const [selected, setSelected] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['member-all-invoices', memberId],
    enabled: open && !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, subtotal, discount_amount, tax_amount, total_amount, amount_paid, status, due_date, created_at, invoice_type, is_gst_invoice, gst_rate')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['member-all-invoices', memberId] });
    qc.invalidateQueries({ queryKey: ['member-pending-invoices', memberId] });
    qc.invalidateQueries({ queryKey: ['member-payments', memberId] });
    qc.invalidateQueries({ queryKey: ['member-details'] });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              Invoices &amp; Payments
            </SheetTitle>
            <SheetDescription>
              Record a payment, correct a wrongly-entered amount, or cancel an invoice.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-3">
            {isLoading && [1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}

            {!isLoading && invoices.length === 0 && (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-slate-500">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                  No invoices for this member yet.
                </CardContent>
              </Card>
            )}

            {invoices.map((inv: any) => {
              const due = (inv.total_amount || 0) - (inv.amount_paid || 0);
              const closed = inv.status === 'cancelled' || inv.status === 'refunded';
              return (
                <Card key={inv.id} className="rounded-2xl shadow-sm">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{inv.invoice_number}</p>
                        <p className="text-xs text-slate-500">
                          {inv.created_at ? format(new Date(inv.created_at), 'dd MMM yyyy') : ''}
                          {inv.invoice_type ? ` · ${inv.invoice_type}` : ''}
                        </p>
                      </div>
                      <Badge className={`${statusClass(inv.status)} rounded-full px-2.5 py-0.5 text-xs font-medium capitalize`}>
                        {inv.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-slate-500">Total</p>
                        <p className="font-semibold text-slate-900">₹{Number(inv.total_amount || 0).toLocaleString('en-IN')}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Paid</p>
                        <p className="font-semibold text-slate-900">₹{Number(inv.amount_paid || 0).toLocaleString('en-IN')}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Balance</p>
                        <p className={`font-semibold ${due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          ₹{Math.abs(due).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!closed && due > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="cursor-pointer"
                          onClick={() => { setSelected(inv); setPayOpen(true); }}
                        >
                          <IndianRupee className="h-3 w-3 mr-1" />Record payment
                        </Button>
                      )}
                      {canAmend && !closed && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="cursor-pointer"
                            onClick={() => { setSelected(inv); setCorrectOpen(true); }}
                          >
                            <Pencil className="h-3 w-3 mr-1" />Correct amount
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="cursor-pointer text-destructive hover:text-destructive"
                            onClick={() => { setSelected(inv); setCancelOpen(true); }}
                          >
                            <XCircle className="h-3 w-3 mr-1" />Cancel invoice
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {selected && (
        <RecordPaymentDrawer
          open={payOpen}
          onOpenChange={(o) => { setPayOpen(o); if (!o) refresh(); }}
          invoice={selected}
          branchId={branchId}
        />
      )}

      <CorrectInvoiceDrawer
        open={correctOpen}
        onOpenChange={setCorrectOpen}
        invoice={selected}
        onCorrected={refresh}
      />

      <CancelInvoiceDrawer
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        invoice={selected}
        onCancelled={refresh}
      />
    </>
  );
}
