import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { editExpense, EXPENSE_METHODS, EXPENSE_TYPE_LABEL, type ExpenseRow } from '@/services/expenseService';
import type { PaymentMethodEnum } from '@/lib/payments/normalizePaymentMethod';

interface EditExpenseDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: ExpenseRow | null;
}

export function EditExpenseDrawer({ open, onOpenChange, expense }: EditExpenseDrawerProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vendor, setVendor] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [method, setMethod] = useState<PaymentMethodEnum>('cash');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [isPaid, setIsPaid] = useState(true);
  const [reason, setReason] = useState('');

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_categories').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!expense) return;
    setAmount(String(expense.amount ?? ''));
    setDescription(expense.description || '');
    setCategoryId(expense.category_id || '');
    setVendor(expense.vendor || '');
    setExpenseDate(expense.expense_date || '');
    setMethod((expense.payment_method as PaymentMethodEnum) || 'cash');
    setReference(expense.payment_reference || '');
    setPaidAt(expense.paid_at || '');
    setBillNumber(expense.bill_number || '');
    setIsPaid(expense.is_paid ?? true);
    setReason('');
  }, [expense]);

  const mutation = useMutation({
    mutationFn: async () =>
      editExpense({
        expenseId: expense!.id,
        reason,
        amount: Number(amount),
        description,
        categoryId: categoryId || null,
        vendor: vendor || null,
        expenseDate: expenseDate || null,
        paymentMethod: method,
        paymentReference: reference || null,
        paidAt: paidAt || null,
        billNumber: billNumber || null,
        isPaid,
      }),
    onSuccess: () => {
      ['finance-expenses', 'pending-expenses', 'expenses-console', 'salary-advances'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      );
      toast.success('Expense corrected — change recorded in the audit trail');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to edit expense'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" /> Edit Expense
          </SheetTitle>
          <SheetDescription>
            Corrections require a reason. Every change is stamped with who edited it and when.
          </SheetDescription>
        </SheetHeader>

        {expense && (
          <div className="space-y-5 py-5">
            <Card className="rounded-2xl border-border/60">
              <CardContent className="pt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium">{EXPENSE_TYPE_LABEL[expense.expense_type] || 'General'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current amount</span>
                  <span className="font-semibold">₹{Number(expense.amount || 0).toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recorded on</span>
                  <span>{expense.expense_date ? format(new Date(expense.expense_date), 'dd MMM yyyy') : '—'}</span>
                </div>
                {expense.edit_reason && (
                  <div className="pt-1 text-xs italic text-muted-foreground">Last correction: {expense.edit_reason}</div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-amount">Amount (₹) <span className="text-destructive">*</span></Label>
                <Input id="edit-amount" type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="edit-category" className="rounded-xl"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
              {expense.expense_type !== 'salary_advance' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-vendor">Vendor</Label>
                  <Input id="edit-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
                </div>
              )}
              {expense.expense_type === 'vendor_bill' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-bill">Bill / invoice number</Label>
                  <Input id="edit-bill" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="edit-date">Expense date</Label>
                <Input id="edit-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-method">Mode of payment</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethodEnum)}>
                  <SelectTrigger id="edit-method" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_METHODS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ref">Reference number</Label>
                <Input id="edit-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-paid-at">Paid on</Label>
                <Input id="edit-paid-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
              {expense.expense_type === 'vendor_bill' && (
                <div className="md:col-span-2 flex items-center justify-between rounded-xl border p-3">
                  <Label htmlFor="edit-is-paid" className="cursor-pointer">Bill paid</Label>
                  <Switch id="edit-is-paid" checked={isPaid} onCheckedChange={setIsPaid} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-reason">Reason for correction <span className="text-destructive">*</span></Label>
              <Textarea id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. amount entered as 30000 instead of 3000" className="min-h-[80px]" />
            </div>
          </div>
        )}

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button
            disabled={mutation.isPending || !reason.trim() || !amount || Number(amount) <= 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Pencil className="h-4 w-4 mr-1" />}
            Save correction
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
