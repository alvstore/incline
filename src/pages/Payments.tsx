import { AppLayout } from '@/components/layout/AppLayout';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from '@/components/ui/stat-card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CreditCard, Wallet, TrendingUp, Receipt, Search, Download, Filter, X, Ban, Plus, AlertTriangle, ChevronDown, Send, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AddExpenseDrawer } from '@/components/finance/AddExpenseDrawer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { recordPayment as unifiedRecordPayment, voidPayment as unifiedVoidPayment } from '@/services/billingService';
import { normalizePaymentMethod } from '@/lib/payments/normalizePaymentMethod';
import { useState, useMemo, useEffect } from 'react';
import { format, isWithinInterval, parseISO } from 'date-fns';
import { toast } from 'sonner';

export default function PaymentsPage() {
  const { branchFilter } = useBranchContext();
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>(undefined);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingPayment, setVoidingPayment] = useState<any>(null);
  const [voidReason, setVoidReason] = useState('');
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ member_search: '', amount: '', payment_method: 'cash', notes: '' });
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [duesOpen, setDuesOpen] = useState(true);

  useRealtimeInvalidate({
    channel: 'page-payments',
    tables: ['payments', 'invoices', 'payment_transactions'],
    invalidateKeys: [
      ['payments'],
      ['invoices'],
      ['all-overdue-invoices'],
      ['member-overdue-invoices'],
    ],
  });

  // Cmd+K: ?new=1 opens Record Payment
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setRecordPaymentOpen(true);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const isAdminOrOwner = roles?.some((r: any) => ['admin', 'owner'].includes(typeof r === 'string' ? r : r?.role));

  const { data: memberSearchResults = [] } = useQuery({
    queryKey: ['member-search-payment', paymentForm.member_search, branchFilter],
    enabled: paymentForm.member_search.length >= 2,
    queryFn: async () => {
      const { data } = await supabase.rpc('search_members', {
        search_term: paymentForm.member_search,
        p_branch_id: branchFilter || undefined,
        p_limit: 5,
      });
      return data || [];
    },
  });

  // Fetch overdue invoices for selected member in Record Payment drawer
  const { data: memberInvoices = [] } = useQuery({
    queryKey: ['member-overdue-invoices', selectedMember?.id],
    enabled: !!selectedMember?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_amount, amount_paid, status, due_date, invoice_type, created_at')
        .eq('member_id', selectedMember.id)
        .in('status', ['pending', 'partial', 'overdue'])
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all overdue/partial invoices for Dues Collection card
  const { data: overdueInvoices = [] } = useQuery({
    queryKey: ['all-overdue-invoices', branchFilter],
    queryFn: async () => {
      let query = supabase
        .from('invoices')
        .select(`
          id, invoice_number, total_amount, amount_paid, status, due_date, invoice_type, member_id,
          members(member_code, profiles:user_id(full_name, phone, email, avatar_url), lead:lead_id(full_name, phone, email, avatar_url))
        `)
        .in('status', ['pending', 'partial', 'overdue'])
        .order('due_date', { ascending: true })
        .limit(50);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const totalDues = overdueInvoices.reduce((sum: number, inv: any) => sum + ((inv.total_amount || 0) - (inv.amount_paid || 0)), 0);

  const recordPaymentMutation = useMutation({
    mutationFn: async (form: { memberId: string; amount: number; method: string; notes: string; invoiceId?: string }) => {
      if (!form.invoiceId) {
        // Standalone payment without invoice — direct insert
        const { error } = await (supabase.from('payments') as any).insert({
          member_id: form.memberId,
          branch_id: branchFilter!,
          amount: form.amount,
          payment_method: normalizePaymentMethod(form.method),
          status: 'completed',
          payment_date: new Date().toISOString(),
        });
        if (error) throw error;
        return;
      }
      // Use unified RPC for invoice-linked payments
      await unifiedRecordPayment({
        branchId: branchFilter!,
        invoiceId: form.invoiceId,
        memberId: form.memberId,
        amount: form.amount,
        paymentMethod: form.method,
        notes: form.notes || undefined,
        receivedBy: user?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['all-overdue-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['member-overdue-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Payment recorded successfully');
      setRecordPaymentOpen(false);
      setPaymentForm({ member_search: '', amount: '', payment_method: 'cash', notes: '' });
      setSelectedMember(null);
      setSelectedInvoice(null);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to record payment'),
  });

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments', branchFilter],
    queryFn: async () => {
      let query = supabase
        .from('payments')
        .select(`*, members(member_code, profiles:user_id(full_name)), invoices(invoice_number)`)
        .order('payment_date', { ascending: false })
        .limit(200);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const voidPaymentMutation = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) => {
      await unifiedVoidPayment(paymentId, reason);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['all-overdue-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['member-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['member-wallet-balance'] });
      toast.success('Payment voided — invoice balance reversed');
      setVoidDialogOpen(false);
      setVoidingPayment(null);
      setVoidReason('');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to void payment'),
  });

  const filteredPayments = useMemo(() => {
    return payments.filter((payment: any) => {
      if (searchTerm) {
        const memberName = payment.members?.profiles?.full_name?.toLowerCase() || '';
        const memberCode = payment.members?.member_code?.toLowerCase() || '';
        const invoiceNum = payment.invoices?.invoice_number?.toLowerCase() || '';
        const search = searchTerm.toLowerCase();
        if (!memberName.includes(search) && !memberCode.includes(search) && !invoiceNum.includes(search)) return false;
      }
      if (methodFilter !== 'all' && payment.payment_method !== methodFilter) return false;
      if (statusFilter !== 'all' && payment.status !== statusFilter) return false;
      if (dateRange?.from && dateRange?.to) {
        const paymentDate = parseISO(payment.payment_date);
        if (!isWithinInterval(paymentDate, { start: dateRange.from, end: dateRange.to })) return false;
      }
      return true;
    });
  }, [payments, searchTerm, methodFilter, statusFilter, dateRange]);

  const todayTotal = filteredPayments.filter((p: any) => p.status !== 'voided' && new Date(p.payment_date).toDateString() === new Date().toDateString()).reduce((sum: number, p: any) => sum + p.amount, 0);
  const monthTotal = filteredPayments.filter((p: any) => p.status !== 'voided').reduce((sum: number, p: any) => sum + p.amount, 0);
  const completedTotal = filteredPayments.filter((p: any) => p.status === 'completed').reduce((sum: number, p: any) => sum + p.amount, 0);
  const pendingTotal = filteredPayments.filter((p: any) => p.status === 'pending').reduce((sum: number, p: any) => sum + p.amount, 0);

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = { cash: 'bg-success/10 text-success', card: 'bg-info/10 text-info', upi: 'bg-primary/10 text-primary', wallet: 'bg-warning/10 text-warning', bank_transfer: 'bg-info/10 text-info', online: 'bg-primary/10 text-primary' };
    return colors[method] || 'bg-muted text-muted-foreground';
  };
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = { completed: 'bg-success/10 text-success', pending: 'bg-warning/10 text-warning', failed: 'bg-destructive/10 text-destructive', refunded: 'bg-warning/10 text-warning', voided: 'bg-destructive/10 text-destructive line-through' };
    return colors[status] || 'bg-muted text-muted-foreground';
  };
  const clearFilters = () => { setSearchTerm(''); setMethodFilter('all'); setStatusFilter('all'); setDateRange(undefined); };
  const hasActiveFilters = searchTerm || methodFilter !== 'all' || statusFilter !== 'all' || dateRange;

  const exportToCSV = () => {
    const headers = ['Date', 'Member', 'Amount', 'Method', 'Status', 'Invoice'];
    const rows = filteredPayments.map((p: any) => [format(new Date(p.payment_date), 'dd/MM/yyyy HH:mm'), p.members?.profiles?.full_name || 'Walk-in', p.amount, p.payment_method, p.status, p.invoices?.invoice_number || '-']);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `payments-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    window.URL.revokeObjectURL(url);
  };

  const openVoidDialog = (payment: any) => {
    setVoidingPayment(payment);
    setVoidReason('');
    setVoidDialogOpen(true);
  };

  const handleCollectFromDues = (invoice: any) => {
    setSelectedMember({
      id: invoice.member_id,
      full_name: invoice.members?.profiles?.full_name || 'Unknown',
      member_code: invoice.members?.member_code || '',
    });
    setSelectedInvoice(invoice);
    setPaymentForm(f => ({
      ...f,
      amount: String((invoice.total_amount || 0) - (invoice.amount_paid || 0)),
      member_search: '',
    }));
    setRecordPaymentOpen(true);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-success to-success text-primary-foreground">
                <CreditCard className="h-6 w-6" />
              </div>
              Payments
            </h1>
            <p className="text-muted-foreground mt-1">Track and manage all payment transactions</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild className="rounded-xl"><Link to="/integrations/webhooks"><Activity className="h-4 w-4 mr-2" />Webhook Activity</Link></Button>
            <Button variant="outline" size="sm" onClick={() => setAddExpenseOpen(true)} className="rounded-xl"><Receipt className="h-4 w-4 mr-2" />Add Expense</Button>
            <Button size="sm" onClick={() => setRecordPaymentOpen(true)} className="rounded-xl shadow-lg shadow-primary/20"><CreditCard className="h-4 w-4 mr-2" />Record Payment</Button>
            <Button variant="outline" size="sm" onClick={exportToCSV} className="rounded-xl"><Download className="h-4 w-4 mr-2" />Export</Button>
          </div>
        </div>

        {/* Dues Collection Card */}
        {overdueInvoices.length > 0 && (
          <Collapsible open={duesOpen} onOpenChange={setDuesOpen}>
            <Card className="rounded-2xl border-warning/30 bg-warning/5">
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-warning/10 transition-colors rounded-t-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-warning/20">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Dues Collection</CardTitle>
                        <p className="text-sm text-muted-foreground">{overdueInvoices.length} pending invoices • Total: ₹{totalDues.toLocaleString()}</p>
                      </div>
                    </div>
                    <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${duesOpen ? 'rotate-180' : ''}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Invoices</TableHead>
                          <TableHead>Total Due</TableHead>
                          <TableHead>Earliest Due Date</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          // Group invoices by member so a single member with multiple
                          // pending invoices shows up as one row, not five.
                          const grouped = new Map<string, { name: string; code: string; invoices: any[]; total: number; earliest: Date | null }>();
                          for (const inv of overdueInvoices as any[]) {
                            const key = inv.member_id || inv.id;
                            const due = (inv.total_amount || 0) - (inv.amount_paid || 0);
                            const existing = grouped.get(key) || {
                              name: inv.members?.profiles?.full_name || 'Unknown',
                              code: inv.members?.member_code || '',
                              invoices: [],
                              total: 0,
                              earliest: null,
                            };
                            existing.invoices.push(inv);
                            existing.total += due;
                            const dueDate = inv.due_date ? new Date(inv.due_date) : null;
                            if (dueDate && (!existing.earliest || dueDate < existing.earliest)) {
                              existing.earliest = dueDate;
                            }
                            grouped.set(key, existing);
                          }
                          return Array.from(grouped.entries()).map(([key, g]) => {
                            const isOverdue = g.earliest && g.earliest < new Date();
                            return (
                              <TableRow key={key}>
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{g.name}</p>
                                    <p className="text-xs text-muted-foreground">{g.code}</p>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary" className="rounded-full">
                                    {g.invoices.length} invoice{g.invoices.length > 1 ? 's' : ''}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-semibold text-destructive">₹{g.total.toLocaleString()}</TableCell>
                                <TableCell>
                                  {g.earliest ? (
                                    <span className={isOverdue ? 'text-destructive font-medium' : ''}>
                                      {format(g.earliest, 'dd MMM')}
                                    </span>
                                  ) : '-'}
                                </TableCell>
                                <TableCell>
                                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => handleCollectFromDues(g.invoices[0])}>
                                    <CreditCard className="h-3 w-3" />Collect
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          });
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        <Card className="rounded-2xl border-border/50 shadow-lg shadow/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" />Filters</CardTitle>
              {hasActiveFilters && (<Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-4 w-4 mr-1" />Clear All</Button>)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search member, code, or invoice..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 rounded-xl" /></div>
              <DateRangeFilter onChange={(range) => setDateRange(range || undefined)} />
              <Select value={methodFilter} onValueChange={setMethodFilter}><SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Method" /></SelectTrigger><SelectContent><SelectItem value="all">All Methods</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="wallet">Wallet</SelectItem><SelectItem value="bank_transfer">Bank Transfer</SelectItem><SelectItem value="online">Online</SelectItem></SelectContent></Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="refunded">Refunded</SelectItem><SelectItem value="voided">Voided</SelectItem></SelectContent></Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <StatCard title="Today's Collection" value={`₹${todayTotal.toLocaleString()}`} icon={CreditCard} variant="accent" />
          <StatCard title="Filtered Total" value={`₹${monthTotal.toLocaleString()}`} icon={TrendingUp} variant="success" />
          <StatCard title="Completed" value={`₹${completedTotal.toLocaleString()}`} icon={Receipt} variant="default" />
          <StatCard title="Pending" value={`₹${pendingTotal.toLocaleString()}`} icon={Wallet} variant="info" />
        </div>

        <Card className="rounded-2xl border-border/50 shadow-lg">
          <CardHeader><CardTitle>{hasActiveFilters ? `Filtered Payments (${filteredPayments.length})` : `Recent Payments (${payments.length})`}</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (<TableSkeleton rows={8} columns={isAdminOrOwner ? 7 : 6} />) : (
              <Table>
                <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Invoice</TableHead><TableHead>Date</TableHead>{isAdminOrOwner && <TableHead>Actions</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {filteredPayments.map((payment: any) => {
                    const isVoided = payment.status === 'voided';
                    return (
                      <TableRow key={payment.id} className={isVoided ? 'opacity-50' : ''}>
                        <TableCell><div className="flex flex-col"><span className={`font-medium ${isVoided ? 'line-through' : ''}`}>{payment.members?.profiles?.full_name || 'Walk-in'}</span>{payment.members?.member_code && <span className="text-xs text-muted-foreground">{payment.members.member_code}</span>}</div></TableCell>
                        <TableCell className={`font-medium ${isVoided ? 'line-through' : ''}`}>₹{payment.amount.toLocaleString()}</TableCell>
                        <TableCell><Badge className={getMethodColor(payment.payment_method)}>{payment.payment_method}</Badge></TableCell>
                        <TableCell><Badge className={getStatusColor(payment.status)}>{payment.status}</Badge></TableCell>
                        <TableCell className="font-mono text-sm">{payment.invoices?.invoice_number || '-'}</TableCell>
                        <TableCell>{format(new Date(payment.payment_date), 'dd MMM yyyy HH:mm')}</TableCell>
                        {isAdminOrOwner && (
                          <TableCell>
                            {!isVoided && payment.status !== 'failed' && (
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => openVoidDialog(payment)}>
                                <Ban className="h-4 w-4 mr-1" /> Void
                              </Button>
                            )}
                            {isVoided && payment.void_reason && (
                              <span className="text-xs text-muted-foreground italic">Reason: {payment.void_reason}</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {filteredPayments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isAdminOrOwner ? 7 : 6} className="text-center py-16 text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-16 w-16 rounded-full bg-muted/80 flex items-center justify-center">
                            <CreditCard className="h-8 w-8 opacity-40" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground/70">{hasActiveFilters ? 'No payments match your filters' : 'No payments recorded yet'}</p>
                            <p className="text-sm mt-1">{hasActiveFilters ? 'Try adjusting your search or filter criteria' : 'Record your first payment to get started'}</p>
                          </div>
                          {hasActiveFilters && (
                            <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2">
                              <X className="h-4 w-4 mr-1" /> Clear Filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Void Payment Confirmation */}
      <AlertDialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Void Payment
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The original record will be preserved for audit purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {voidingPayment && (
            <Card className="border-destructive/20 bg-destructive/5">
              <CardContent className="pt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-semibold">₹{voidingPayment.amount?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Member:</span>
                  <span>{voidingPayment.members?.profiles?.full_name || 'Walk-in'}</span>
                </div>
                {voidingPayment.invoices?.invoice_number && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice:</span>
                    <span className="font-mono">{voidingPayment.invoices.invoice_number}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-destructive/10">
                  <span className="text-muted-foreground">Impact:</span>
                  <span className="text-destructive font-medium">
                    {voidingPayment.invoices?.invoice_number
                      ? `₹${voidingPayment.amount?.toLocaleString()} reverted on invoice`
                      : 'Payment marked as voided'}
                  </span>
                </div>
                {voidingPayment.payment_method === 'wallet' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Wallet:</span>
                    <span className="text-success font-medium">₹{voidingPayment.amount?.toLocaleString()} refunded</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <div className="space-y-3 py-2">
            <Label>Reason for voiding <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="Enter the reason for voiding this payment (e.g., duplicate entry, incorrect amount)"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!voidReason.trim() || voidPaymentMutation.isPending}
              onClick={() => voidPaymentMutation.mutate({ paymentId: voidingPayment?.id, reason: voidReason })}
            >
              <Ban className="h-4 w-4 mr-1" /> Void Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Record Payment Drawer */}
      <Sheet open={recordPaymentOpen} onOpenChange={(open) => {
        setRecordPaymentOpen(open);
        if (!open) { setSelectedMember(null); setSelectedInvoice(null); }
      }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Record Payment</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Search Member</Label>
              <Input
                placeholder="Name, phone, or code..."
                value={selectedMember ? selectedMember.full_name : paymentForm.member_search}
                onChange={(e) => {
                  setSelectedMember(null);
                  setSelectedInvoice(null);
                  setPaymentForm(f => ({ ...f, member_search: e.target.value, amount: '' }));
                }}
              />
              {!selectedMember && memberSearchResults.length > 0 && paymentForm.member_search.length >= 2 && (
                <div className="border rounded-lg mt-1 max-h-40 overflow-y-auto">
                  {memberSearchResults.map((m: any) => (
                    <div key={m.id} className="p-2 hover:bg-muted cursor-pointer text-sm" onClick={() => { setSelectedMember(m); setPaymentForm(f => ({ ...f, member_search: '' })); setSelectedInvoice(null); }}>
                      <span className="font-medium">{m.full_name}</span> <span className="text-muted-foreground">({m.member_code})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Show member's overdue invoices */}
            {selectedMember && memberInvoices.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Pending Invoices
                </Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {memberInvoices.map((inv: any) => {
                    const dueAmount = (inv.total_amount || 0) - (inv.amount_paid || 0);
                    const isSelected = selectedInvoice?.id === inv.id;
                    return (
                      <div
                        key={inv.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          setSelectedInvoice(inv);
                          setPaymentForm(f => ({ ...f, amount: String(dueAmount) }));
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-sm font-medium">{inv.invoice_number}</p>
                            <p className="text-xs text-muted-foreground capitalize">{(inv.invoice_type || 'manual').replace('_', ' ')}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-destructive">₹{dueAmount.toLocaleString()}</p>
                            <Badge className={`text-[10px] ${
                              inv.status === 'overdue' ? 'bg-destructive/10 text-destructive' :
                              inv.status === 'partial' ? 'bg-warning/10 text-warning' :
                              'bg-warning/10 text-warning'
                            }`}>
                              {inv.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedMember && memberInvoices.length === 0 && (
              <p className="text-sm text-success flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success inline-block" />
                No pending dues for this member
              </p>
            )}

            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" placeholder="0" value={paymentForm.amount} onChange={(e) => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentForm.payment_method} onValueChange={(v) => setPaymentForm(f => ({ ...f, payment_method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea placeholder="Optional notes..." value={paymentForm.notes} onChange={(e) => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <SheetFooter>
            <Button
              className="w-full"
              disabled={!selectedMember || !paymentForm.amount || recordPaymentMutation.isPending}
              onClick={() => recordPaymentMutation.mutate({
                memberId: selectedMember.id,
                amount: parseFloat(paymentForm.amount),
                method: paymentForm.payment_method,
                notes: paymentForm.notes,
                invoiceId: selectedInvoice?.id,
              })}
            >
              <CreditCard className="h-4 w-4 mr-2" /> Record Payment
              {selectedInvoice && <span className="ml-1 text-xs opacity-75">→ {selectedInvoice.invoice_number}</span>}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Add Expense Drawer */}
      {branchFilter && <AddExpenseDrawer open={addExpenseOpen} onOpenChange={setAddExpenseOpen} branchId={branchFilter} />}
    </AppLayout>
  );
}
