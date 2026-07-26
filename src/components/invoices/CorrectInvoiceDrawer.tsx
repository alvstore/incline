import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle, IndianRupee, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface InvoiceLite {
  id: string;
  invoice_number: string;
  subtotal: number | null;
  discount_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  amount_paid: number | null;
  status: string;
  is_gst_invoice?: boolean | null;
  gst_rate?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceLite | null;
  onCorrected?: () => void;
}

type Settlement =
  | 'leave_due'
  | 'refund_wallet'
  | 'refund_cash'
  | 'refund_upi'
  | 'credit_wallet';

export function CorrectInvoiceDrawer({ open, onOpenChange, invoice, onCorrected }: Props) {
  const qc = useQueryClient();
  const [total, setTotal] = useState<string>('');
  const [discount, setDiscount] = useState<string>('0');
  const [taxRate, setTaxRate] = useState<string>('0');
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<Settlement>('leave_due');
  const [lineDesc, setLineDesc] = useState('');

  useEffect(() => {
    if (open && invoice) {
      setTotal(String(invoice.total_amount ?? 0));
      setDiscount(String(invoice.discount_amount ?? 0));
      setTaxRate(String(invoice.gst_rate ?? (invoice.is_gst_invoice ? 5 : 0)));
      setReason('');
      setSettlement('leave_due');
      setLineDesc('');
    }
  }, [open, invoice?.id]);

  const totalNum = Number(total) || 0;
  const discountNum = Number(discount) || 0;
  const taxRateNum = Number(taxRate) || 0;

  // Derive subtotal + tax when the new total is inclusive of GST
  const { subtotalDerived, taxDerived } = useMemo(() => {
    if (taxRateNum > 0) {
      const divisor = 1 + taxRateNum / 100;
      const sub = +(totalNum / divisor).toFixed(2);
      const tax = +(totalNum - sub).toFixed(2);
      return { subtotalDerived: sub, taxDerived: tax };
    }
    return { subtotalDerived: totalNum, taxDerived: 0 };
  }, [totalNum, taxRateNum]);

  const currentPaid = Number(invoice?.amount_paid || 0);
  const delta = +(currentPaid - totalNum).toFixed(2); // >0 => overpayment
  const overpaid = delta > 0;
  const underpaid = delta < 0;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('No invoice');
      const { data, error } = await supabase.rpc('correct_invoice', {
        p_invoice_id: invoice.id,
        p_new_subtotal: subtotalDerived,
        p_new_discount: discountNum,
        p_new_tax: taxDerived,
        p_new_total: totalNum,
        p_reason: reason.trim(),
        p_settlement: overpaid ? settlement : 'leave_due',
        p_line_description: lineDesc.trim() || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Invoice corrected');
      qc.invalidateQueries({ queryKey: ['invoice-details'] });
      qc.invalidateQueries({ queryKey: ['invoice-payments'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['member-invoices'] });
      onCorrected?.();
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Correction failed');
    },
  });

  const canSubmit =
    !!invoice &&
    totalNum >= 0 &&
    reason.trim().length >= 6 &&
    !mutation.isPending;

  if (!invoice) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Correct Invoice {invoice.invoice_number}
          </SheetTitle>
          <SheetDescription>
            Fix a wrongly-entered amount, discount, or tax. Every correction is
            audit-logged and the linked membership is updated automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <Card className="bg-slate-50">
            <CardContent className="pt-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Current total</span>
                <span className="font-medium">₹{Number(invoice.total_amount || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Currently paid</span>
                <span className="font-medium">₹{currentPaid.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span className="font-medium capitalize">{invoice.status}</span>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="new-total">New total (₹, inclusive of GST)</Label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                id="new-total"
                type="number"
                min="0"
                step="0.01"
                className="pl-9"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new-discount">Discount (₹)</Label>
              <Input
                id="new-discount"
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax-rate">GST rate (%)</Label>
              <Input
                id="tax-rate"
                type="number"
                min="0"
                max="28"
                step="0.5"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </div>
          </div>

          <Card className="bg-indigo-50/50 border-indigo-100">
            <CardContent className="pt-4 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-600">Derived subtotal</span>
                <span className="font-mono">₹{subtotalDerived.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Derived GST</span>
                <span className="font-mono">₹{taxDerived.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="text-slate-700 font-semibold">New total</span>
                <span className="font-mono font-semibold">₹{totalNum.toLocaleString()}</span>
              </div>
              <div className={`flex justify-between pt-1 ${overpaid ? 'text-emerald-700' : underpaid ? 'text-red-700' : 'text-slate-500'}`}>
                <span>
                  {overpaid ? 'Overpayment to settle' : underpaid ? 'Additional due' : 'No balance change'}
                </span>
                <span className="font-mono font-semibold">
                  ₹{Math.abs(delta).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {overpaid && (
            <div className="space-y-2">
              <Label>Settle overpayment as</Label>
              <RadioGroup value={settlement} onValueChange={(v) => setSettlement(v as Settlement)} className="space-y-1">
                {[
                  { v: 'refund_cash', label: 'Cash refund' },
                  { v: 'refund_upi', label: 'UPI / bank refund' },
                  { v: 'credit_wallet', label: 'Credit member wallet' },
                  { v: 'refund_wallet', label: 'Refund via wallet (ledger only)' },
                  { v: 'leave_due', label: 'Leave as unsettled (do nothing)' },
                ].map((opt) => (
                  <label key={opt.v} className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value={opt.v} id={`s-${opt.v}`} />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="line-desc">Line item description (optional)</Label>
            <Input
              id="line-desc"
              placeholder="Leave blank to keep current description"
              value={lineDesc}
              onChange={(e) => setLineDesc(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason for correction <span className="text-red-500">*</span></Label>
            <Textarea
              id="reason"
              placeholder="e.g. Wrong price entered at billing — should have been ₹18,000 instead of ₹19,999"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-slate-500">Minimum 6 characters. This is written to the audit log.</p>
          </div>

          <div className="sticky bottom-0 -mx-6 px-6 pt-4 pb-2 bg-white border-t flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!canSubmit}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply correction
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
