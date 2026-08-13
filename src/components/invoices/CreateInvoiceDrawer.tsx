import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { Plus, Trash2, FileText, IndianRupee, History, Clock, CheckCircle2, Wallet, CreditCard } from 'lucide-react';
import { useGstRates } from '@/hooks/useGstRates';
import { InvoiceMemberPicker, type InvoiceMember } from '@/components/invoices/InvoiceMemberPicker';
import { InvoiceCatalogPicker, type CatalogItem } from '@/components/invoices/InvoiceCatalogPicker';

interface CreateInvoiceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

const DUE_DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '10 days', days: 10 },
  { label: '15 days', days: 15 },
];

export function CreateInvoiceDrawer({ open, onOpenChange, branchId }: CreateInvoiceDrawerProps) {
  const queryClient = useQueryClient();
  const { data: gstRates = [5, 12, 18, 28] } = useGstRates();
  const [member, setMember] = useState<InvoiceMember | null>(null);
  const [billDate, setBillDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [gstRate, setGstRate] = useState(5);
  const [includeGst, setIncludeGst] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [transactionId, setTransactionId] = useState('');
  const [items, setItems] = useState<LineItem[]>([
    { description: '', quantity: 1, unit_price: 0 },
  ]);

  const memberId = member?.id || '';

  const { data: memberGstinRow } = useQuery({
    queryKey: ['invoice-member-gstin', memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase.from('members').select('gstin').eq('id', memberId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const memberGstin = (memberGstinRow as any)?.gstin || '';

  const addItem = () => {
    setItems([...items, { description: '', quantity: 1, unit_price: 0 }]);
  };

  const addCatalogItem = (c: CatalogItem) => {
    setItems((prev) => {
      const next = [...prev];
      const blank = next.findIndex((i) => !i.description && !i.unit_price);
      const row: LineItem = { description: c.name, quantity: 1, unit_price: c.price };
      if (blank >= 0) next[blank] = row;
      else next.push(row);
      return next;
    });
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof LineItem, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };


  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  };

  const calculateTax = () => {
    if (!includeGst) return 0;
    const subtotal = calculateSubtotal() - discountAmount;
    return Math.round(subtotal * (gstRate / 100));
  };

  const calculateTotal = () => {
    return calculateSubtotal() - discountAmount + calculateTax();
  };

  const createInvoice = useMutation({
    mutationFn: async () => {
      const validItems = items.filter(item => item.description && item.unit_price > 0);
      if (validItems.length === 0) {
        throw new Error('Please add at least one valid line item');
      }

      // Atomic RPC: invoice + items in one transaction.
      const { data, error } = await supabase.rpc('create_manual_invoice', {
        p_branch_id: branchId,
        p_member_id: memberId || null,
        p_items: validItems.map(it => ({
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
        })) as never,
        p_due_date: dueDate || null,
        p_notes: notes || null,
        p_discount_amount: discountAmount,
        p_include_gst: includeGst,
        p_gst_rate: includeGst ? gstRate : 0,
        p_customer_gstin: includeGst ? memberGstin || null : null,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; invoice_id?: string };
      if (!result?.success) throw new Error(result?.error || 'Invoice creation failed');

      const invoiceId = result.invoice_id;

      // If marked as paid, record the payment immediately
      if (isPaid && invoiceId) {
        const { error: payErr } = await supabase.rpc('record_payment', {
          p_invoice_id: invoiceId,
          p_member_id: memberId || null,
          p_branch_id: branchId,
          p_amount: calculateTotal(),
          p_payment_method: paymentMethod,
          p_payment_date: format(new Date(), 'yyyy-MM-dd'),
          p_transaction_id: transactionId.trim() || null,
        } as any);
        if (payErr) throw payErr;
      }

      return { id: invoiceId };
    },
    onSuccess: () => {
      toast.success('Invoice created successfully');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create invoice');
    },
  });

  const resetForm = () => {
    setMember(null);
    setBillDate(format(new Date(), 'yyyy-MM-dd'));
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
    setDiscountAmount(0);
    setIsPaid(false);
    setPaymentMethod('cash');
    setTransactionId('');
    setItems([{ description: '', quantity: 1, unit_price: 0 }]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Create Invoice
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Member Selection */}
          <div className="space-y-2">
            <Label>Member (optional)</Label>
            <InvoiceMemberPicker branchId={branchId} value={member} onChange={setMember} />
          </div>


          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Bill Date</Label>
              <Input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {DUE_DATE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                className="h-7 text-[10px] px-2 rounded-full cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setDueDate(format(addDays(new Date(), preset.days), 'yyyy-MM-dd'))}
              >
                <Clock className="h-3 w-3 mr-1 opacity-60" />
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label>Line Items</Label>
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={addItem}>
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>
            </div>

            <InvoiceCatalogPicker branchId={branchId} onPick={addCatalogItem} />


            {items.map((item, index) => (
              <Card key={index}>
                <CardContent className="pt-4 space-y-3">
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Rate (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={item.unit_price}
                        onChange={(e) => updateItem(index, 'unit_price', Number(e.target.value))}
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Amount</Label>
                        <div className="h-10 flex items-center font-medium">
                          ₹{(item.quantity * item.unit_price).toLocaleString()}
                        </div>
                      </div>
                      {items.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(index)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* GST & Discount */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Discount (₹)</Label>
              <Input
                type="number"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>GST Rate (%)</Label>
              <Select value={includeGst ? gstRate.toString() : '0'} onValueChange={(v) => {
                if (v === '0') {
                  setIncludeGst(false);
                } else {
                  setIncludeGst(true);
                  setGstRate(Number(v));
                }
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No GST</SelectItem>
                  {gstRates.map((rate: number) => (
                    <SelectItem key={rate} value={rate.toString()}>{rate}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          {/* Quick Payment Settlement */}
          <Card className="border-indigo-100 bg-indigo-50/30">
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-slate-900 cursor-pointer" htmlFor="instant-pay">
                      Mark as Paid Immediately
                    </Label>
                    <p className="text-[10px] text-slate-500">Record settlement now instead of creating as unpaid dues</p>
                  </div>
                </div>
                <Switch 
                  id="instant-pay"
                  checked={isPaid} 
                  onCheckedChange={setIsPaid} 
                />
              </div>

              {isPaid && (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="space-y-2">
                    <Label className="text-xs">Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">
                          <div className="flex items-center gap-2">
                            <Wallet className="h-3.5 w-3.5" /> Cash
                          </div>
                        </SelectItem>
                        <SelectItem value="upi">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-3.5 w-3.5" /> UPI
                          </div>
                        </SelectItem>
                        <SelectItem value="bank_transfer">
                          <div className="flex items-center gap-2">
                            <History className="h-3.5 w-3.5" /> Bank Transfer
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">UTR / Trans ID</Label>
                    <Input
                      placeholder="Optional"
                      className="h-9 text-xs"
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>₹{calculateSubtotal().toLocaleString()}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-success">
                  <span>Discount</span>
                  <span>-₹{discountAmount.toLocaleString()}</span>
                </div>
              )}
              {includeGst && (
                <>
                  <div className="flex justify-between text-sm">
                    <span>CGST ({gstRate / 2}%)</span>
                    <span>₹{(calculateTax() / 2).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>SGST ({gstRate / 2}%)</span>
                    <span>₹{(calculateTax() / 2).toLocaleString()}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>Total</span>
                <span className="flex items-center">
                  <IndianRupee className="h-4 w-4" />
                  {calculateTotal().toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending}>
            {createInvoice.isPending ? 'Creating...' : 'Create Invoice'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
