import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { CreditCard, IndianRupee, Wallet, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWallet } from '@/services/walletService';
import { recordPayment } from '@/services/billingService';
import { supabase } from '@/integrations/supabase/client';
import { can } from '@/lib/auth/permissions';


interface RecordPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any;
  memberId?: string;
  branchId: string;
}

export function RecordPaymentDrawer({ 
  open, 
  onOpenChange, 
  invoice, 
  memberId,
  branchId 
}: RecordPaymentDrawerProps) {
  const { user, roles } = useAuth() as any;
  const queryClient = useQueryClient();
  const canBackdate = can.approveDiscount(roles);
  const todayIso = new Date().toISOString().slice(0, 10);

  const dueAmount = invoice ? (invoice.total_amount - (invoice.amount_paid || 0)) : 0;
  
  const [amount, setAmount] = useState(dueAmount);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [transactionId, setTransactionId] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [incomeCategoryId, setIncomeCategoryId] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(todayIso);

  const effectiveMemberId = memberId || invoice?.member_id;


  // Fetch wallet balance when wallet payment method is selected
  const { data: walletData, isLoading: walletLoading } = useQuery({
    queryKey: ['member-wallet-balance', effectiveMemberId],
    queryFn: () => fetchWallet(effectiveMemberId!),
    enabled: open && paymentMethod === 'wallet' && !!effectiveMemberId,
  });

  const { data: incomeCategories = [] } = useQuery({
    queryKey: ['income-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('income_categories')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const walletBalance = Number(walletData?.balance) || 0;
  const insufficientWallet = paymentMethod === 'wallet' && walletData && amount > walletBalance;

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (amount <= 0) throw new Error('Amount must be greater than 0');
      if (amount > dueAmount) throw new Error('Amount cannot exceed due amount');
      if (!invoice?.id) throw new Error('Invoice is required');
      if (paymentDate > todayIso) throw new Error('Payment date cannot be in the future');

      // Backdated dates keep the wall-clock time so same-day entries stay ordered.
      const backdated = paymentDate !== todayIso
        ? new Date(`${paymentDate}T12:00:00`).toISOString()
        : undefined;

      // Use unified RPC — handles wallet debit, invoice update, membership activation atomically
      return recordPayment({
        branchId,
        invoiceId: invoice.id,
        memberId: effectiveMemberId,
        amount,
        paymentMethod,
        transactionId: (transactionId || utrNumber) || undefined,
        notes: notes || undefined,
        receivedBy: user?.id,
        incomeCategoryId: incomeCategoryId || undefined,
        paymentDate: backdated,
      });
    },

    onSuccess: () => {
      toast.success(`Payment of ₹${amount.toLocaleString()} recorded`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-details'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['member-payments'] });
      queryClient.invalidateQueries({ queryKey: ['member-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['member-wallet-balance'] });
      queryClient.invalidateQueries({ queryKey: ['all-overdue-invoices'] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to record payment');
    },
  });

  const resetForm = () => {
    setAmount(dueAmount);
    setPaymentMethod('cash');
    setTransactionId('');
    setUtrNumber('');
    setNotes('');
    setIncomeCategoryId('');
    setPaymentDate(todayIso);
  };


  // Reset amount when invoice changes
  useEffect(() => {
    setAmount(dueAmount);
  }, [dueAmount]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Record Payment
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Invoice Info */}
          {invoice && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4 space-y-1">
                <p className="font-mono text-sm">{invoice.invoice_number}</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total:</span>
                  <span>₹{invoice.total_amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid:</span>
                  <span className="text-success">₹{(invoice.amount_paid || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-medium border-t pt-1">
                  <span>Due:</span>
                  <span className="text-destructive">₹{dueAmount.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label>Amount (₹) *</Label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                max={dueAmount}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setAmount(dueAmount)}
                className="text-xs"
              >
                Full Amount
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setAmount(Math.round(dueAmount / 2))}
                className="text-xs"
              >
                Half
              </Button>
            </div>
          </div>

          {/* Payment date — backdating is restricted to senior roles */}
          <div className="space-y-2">
            <Label htmlFor="payment-date">Payment Date *</Label>
            <Input
              id="payment-date"
              type="date"
              value={paymentDate}
              max={todayIso}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="cursor-pointer rounded-xl"
            />
            {paymentDate !== todayIso && (
              <p className="text-xs text-amber-600 font-medium">
                This payment will be recorded against {paymentDate}, not today.
              </p>
            )}
          </div>



          {/* Payment Method */}
          <div className="space-y-2">
            <Label>Payment Method *</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="wallet">Wallet</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Wallet Balance Info */}
          {paymentMethod === 'wallet' && (
            <Card className={`border ${insufficientWallet ? 'border-destructive/50 bg-destructive/5' : 'border-primary/20 bg-primary/5'}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Wallet Balance</span>
                  </div>
                  {walletLoading ? (
                    <span className="text-sm text-muted-foreground">Loading...</span>
                  ) : walletData ? (
                    <span className={`text-sm font-bold ${insufficientWallet ? 'text-destructive' : 'text-primary'}`}>
                      ₹{walletBalance.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">No wallet</span>
                  )}
                </div>
                {insufficientWallet && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Insufficient balance. Need ₹{(amount - walletBalance).toLocaleString()} more.
                  </div>
                )}
                {!effectiveMemberId && (
                  <p className="text-xs text-destructive mt-1">Member ID required for wallet payments</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Income Category */}
          <div className="space-y-2">
            <Label>Income Category</Label>
            <Select value={incomeCategoryId} onValueChange={setIncomeCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category (optional)" />
              </SelectTrigger>
              <SelectContent>
                {incomeCategories.map((cat: any) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentMethod !== 'cash' && paymentMethod !== 'wallet' && (
            <div className="space-y-2">
              <Label>{(paymentMethod === 'upi' || paymentMethod === 'bank_transfer') ? 'UTR / Transaction ID' : 'Transaction ID'}</Label>
              <Input
                value={paymentMethod === 'upi' || paymentMethod === 'bank_transfer' ? utrNumber : transactionId}
                onChange={(e) => paymentMethod === 'upi' || paymentMethod === 'bank_transfer' ? setUtrNumber(e.target.value) : setTransactionId(e.target.value)}
                placeholder={paymentMethod === 'upi' ? "Enter UTR number" : "Reference number"}
                className="rounded-xl"
              />
            </div>
          )}

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
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-4">
              <div className="flex justify-between items-center">
                <span className="font-medium">Recording Payment</span>
                <span className="text-xl font-bold flex items-center text-primary">
                  <IndianRupee className="h-5 w-5" />
                  {amount.toLocaleString()}
                </span>
              </div>
              {paymentMethod === 'wallet' && walletData && (
                <p className="text-xs text-muted-foreground mt-1">
                  Wallet balance after: ₹{(walletBalance - amount).toLocaleString()}
                </p>
              )}
              {amount < dueAmount && (
                <p className="text-sm text-muted-foreground mt-1">
                  Remaining due: ₹{(dueAmount - amount).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={() => recordPaymentMutation.mutate()} 
            disabled={
              amount <= 0 || 
              amount > dueAmount || 
              recordPaymentMutation.isPending ||
              (paymentMethod === 'wallet' && (!!insufficientWallet || !effectiveMemberId || !walletData))
            }
          >
            {recordPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
