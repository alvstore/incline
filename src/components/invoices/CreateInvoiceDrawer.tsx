import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Trash2, FileText, IndianRupee } from 'lucide-react';
import { useGstRates } from '@/hooks/useGstRates';

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

export function CreateInvoiceDrawer({ open, onOpenChange, branchId }: CreateInvoiceDrawerProps) {
  const queryClient = useQueryClient();
  const { data: gstRates = [5, 12, 18, 28] } = useGstRates();
  const [memberId, setMemberId] = useState<string>('');
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [gstRate, setGstRate] = useState(5);
  const [includeGst, setIncludeGst] = useState(true);
  const [items, setItems] = useState<LineItem[]>([
    { description: '', quantity: 1, unit_price: 0 },
  ]);

  const { data: members = [] } = useQuery({
    queryKey: ['members-for-invoice', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, member_code, gstin, profiles:user_id(full_name)')
        .eq('branch_id', branchId)
        .eq('status', 'active')
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!branchId,
  });

  // Auto-fill member GSTIN when member is selected
  const selectedMember = members.find((m: any) => m.id === memberId);
  const memberGstin = selectedMember?.gstin || '';

  const addItem = () => {
    setItems([...items, { description: '', quantity: 1, unit_price: 0 }]);
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

      return { id: result.invoice_id };
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
    setMemberId('');
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
    setDiscountAmount(0);
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
            <Select value={memberId || "walk-in"} onValueChange={(val) => setMemberId(val === "walk-in" ? "" : val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select member or leave for walk-in" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                {members.map((member: any) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.profiles?.full_name || member.member_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label>Line Items</Label>
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>
            </div>

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
