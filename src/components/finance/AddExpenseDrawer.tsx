import { useState, useRef, useMemo } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, Loader2, Receipt, Wallet, FileText, HandCoins } from 'lucide-react';
import { format } from 'date-fns';
import { useUnifiedStaff } from '@/hooks/useUnifiedStaff';
import { recordExpense, EXPENSE_METHODS, type ExpenseKind } from '@/services/expenseService';
import type { PaymentMethodEnum } from '@/lib/payments/normalizePaymentMethod';

interface AddExpenseDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  /** Preselect the Salary Advance flow. */
  defaultType?: ExpenseKind;
}

const TYPE_OPTIONS: { value: ExpenseKind; label: string; hint: string; icon: typeof Receipt }[] = [
  { value: 'general', label: 'General', hint: 'Day-to-day spend', icon: Wallet },
  { value: 'vendor_bill', label: 'Vendor Bill', hint: 'Bill / invoice from a vendor', icon: FileText },
  { value: 'salary_advance', label: 'Salary Advance', hint: 'Advance paid to staff', icon: HandCoins },
];

export function AddExpenseDrawer({ open, onOpenChange, branchId, defaultType = 'general' }: AddExpenseDrawerProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: staff = [] } = useUnifiedStaff();

  const emptyForm = {
    expense_type: defaultType as ExpenseKind,
    category_id: '',
    amount: '',
    description: '',
    vendor: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    receipt_url: '',
    payment_method: 'cash' as PaymentMethodEnum,
    payment_reference: '',
    paid_at: format(new Date(), 'yyyy-MM-dd'),
    bill_number: '',
    is_paid: true,
    employee_user_id: '',
    auto_recover: true,
  };

  const [formData, setFormData] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState('');

  const isAdvance = formData.expense_type === 'salary_advance';
  const isBill = formData.expense_type === 'vendor_bill';

  const staffOptions = useMemo(
    () => staff.filter((s) => s.user_id && s.is_active).map((s) => ({ id: s.user_id as string, name: s.name, meta: s.position || s.department || '' })),
    [staff],
  );

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast.error('Please select an image or PDF file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `receipts/${crypto.randomUUID()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('products').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(filePath);
      setFormData((f) => ({ ...f, receipt_url: publicUrl }));
      setReceiptPreview(file.type.startsWith('image/') ? publicUrl : '');
      toast.success('Receipt uploaded successfully');
    } catch (error: any) {
      toast.error('Failed to upload receipt: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () =>
      recordExpense({
        branchId,
        amount: Number(formData.amount),
        description: formData.description,
        expenseType: formData.expense_type,
        categoryId: formData.category_id || null,
        vendor: isAdvance ? null : formData.vendor || null,
        expenseDate: formData.expense_date,
        receiptUrl: formData.receipt_url || null,
        paymentMethod: formData.payment_method,
        paymentReference: formData.payment_reference || null,
        paidAt: formData.is_paid ? formData.paid_at : null,
        billNumber: isBill ? formData.bill_number || null : null,
        isPaid: isBill ? formData.is_paid : true,
        employeeUserId: isAdvance ? formData.employee_user_id : null,
        autoRecover: formData.auto_recover,
      }),
    onSuccess: () => {
      toast.success(isAdvance ? 'Advance recorded and added to the ledger' : 'Expense submitted for approval');
      ['finance-expenses', 'pending-expenses', 'expenses-console', 'salary-advances'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      );
      onOpenChange(false);
      setFormData(emptyForm);
      setReceiptPreview('');
    },
    onError: (error: any) => toast.error(error.message || 'Failed to save expense'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || Number(formData.amount) <= 0 || !formData.description.trim()) {
      toast.error('Amount and description are required');
      return;
    }
    if (isAdvance && !formData.employee_user_id) {
      toast.error('Select the staff member receiving the advance');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Expense</SheetTitle>
          <SheetDescription>Record money going out — general spend, a vendor bill, or a staff salary advance.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-6">
          {/* Expense type */}
          <div className="space-y-2">
            <Label>Expense type</Label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = formData.expense_type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, expense_type: opt.value })}
                    className={`rounded-xl border p-3 text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring ${
                      active ? 'border-primary bg-primary/5 shadow-sm' : 'hover:bg-muted/50'
                    }`}
                    aria-pressed={active}
                  >
                    <Icon className={`h-4 w-4 mb-1.5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">{opt.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Receipt Upload */}
          <div className="space-y-2">
            <Label>Receipt (optional)</Label>
            <div
              className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Uploading...</p>
                </div>
              ) : receiptPreview ? (
                <div className="relative">
                  <img src={receiptPreview} alt="Uploaded expense receipt" className="max-h-32 mx-auto rounded" />
                  <p className="text-xs text-muted-foreground mt-2">Click to change</p>
                </div>
              ) : formData.receipt_url ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Receipt className="h-8 w-8 text-primary" />
                  <p className="text-sm text-primary">Receipt uploaded</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload receipt</p>
                  <p className="text-xs text-muted-foreground">Image or PDF up to 10MB</p>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleReceiptUpload} className="hidden" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={formData.category_id} onValueChange={(v) => setFormData({ ...formData, category_id: v })}>
                <SelectTrigger id="category" className="rounded-xl"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((cat: any) => (<SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Amount (₹) <span className="text-destructive">*</span></Label>
              <Input id="amount" type="number" min="0" step="0.01" value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })} placeholder="5000" required />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
              <Textarea id="description" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={isAdvance ? 'Advance against August salary...' : 'Monthly electricity bill...'} rows={2} required />
            </div>

            {isAdvance ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="staff">Staff member <span className="text-destructive">*</span></Label>
                <Select value={formData.employee_user_id} onValueChange={(v) => setFormData({ ...formData, employee_user_id: v })}>
                  <SelectTrigger id="staff" className="rounded-xl"><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>
                    {staffOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}{s.meta ? ` — ${s.meta}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input id="vendor" value={formData.vendor} onChange={(e) => setFormData({ ...formData, vendor: e.target.value })} placeholder="BSES Power" />
              </div>
            )}

            {isBill && (
              <div className="space-y-2">
                <Label htmlFor="bill_number">Bill / invoice number</Label>
                <Input id="bill_number" value={formData.bill_number} onChange={(e) => setFormData({ ...formData, bill_number: e.target.value })} placeholder="KM/2026/119" />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="expense_date">Expense date</Label>
              <Input id="expense_date" type="date" value={formData.expense_date}
                onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment_method">Mode of payment</Label>
              <Select value={formData.payment_method} onValueChange={(v) => setFormData({ ...formData, payment_method: v as PaymentMethodEnum })}>
                <SelectTrigger id="payment_method" className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_METHODS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment_reference">Reference number</Label>
              <Input id="payment_reference" value={formData.payment_reference}
                onChange={(e) => setFormData({ ...formData, payment_reference: e.target.value })} placeholder="UTR / cheque no. (optional)" />
            </div>

            {isBill && (
              <div className="md:col-span-2 flex items-center justify-between rounded-xl border p-3">
                <div>
                  <Label htmlFor="is_paid" className="cursor-pointer">Bill already paid</Label>
                  <p className="text-xs text-muted-foreground">Turn off to keep it as an unpaid payable.</p>
                </div>
                <Switch id="is_paid" checked={formData.is_paid} onCheckedChange={(v) => setFormData({ ...formData, is_paid: v })} />
              </div>
            )}

            {formData.is_paid && (
              <div className="space-y-2">
                <Label htmlFor="paid_at">Paid on</Label>
                <Input id="paid_at" type="date" value={formData.paid_at}
                  onChange={(e) => setFormData({ ...formData, paid_at: e.target.value })} />
              </div>
            )}

            {isAdvance && (
              <div className="md:col-span-2 flex items-center justify-between rounded-xl border p-3">
                <div>
                  <Label htmlFor="auto_recover" className="cursor-pointer">Recover in next payroll</Label>
                  <p className="text-xs text-muted-foreground">Auto-fills the advance deduction on the next run. Turn off to track manually.</p>
                </div>
                <Switch id="auto_recover" checked={formData.auto_recover} onCheckedChange={(v) => setFormData({ ...formData, auto_recover: v })} />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={saveMutation.isPending} className="flex-1">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isAdvance ? 'Record Advance' : 'Submit Expense'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
