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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreditCard, Wallet, TrendingUp, Receipt, Search, Download, Filter, X, Ban, Pencil, Plus, AlertTriangle, ChevronDown, Send, Activity, HandCoins, ArrowDownRight, ArrowUpRight, Scale, LayoutDashboard, History, Clock, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AddExpenseDrawer } from '@/components/finance/AddExpenseDrawer';
import { EditExpenseDrawer } from '@/components/finance/EditExpenseDrawer';
import { ExpensesTable } from '@/components/finance/ExpensesTable';
import { AdvancesTable } from '@/components/finance/AdvancesTable';
import { PaymentEditDrawer } from '@/components/payments/PaymentEditDrawer';
import { can } from '@/lib/auth/permissions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { recordPayment as unifiedRecordPayment, voidPayment as unifiedVoidPayment } from '@/services/billingService';
import { normalizePaymentMethod } from '@/lib/payments/normalizePaymentMethod';
import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';
import { gatewayDeduction, paymentChannelLabel, isReversedPayment, reversalCaption, reversalLabel } from '@/lib/payments/paymentDisplay';
import type { ExpenseRow, ExpenseKind } from '@/services/expenseService';
import { useState, useMemo, useEffect } from 'react';
import { format, isWithinInterval, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [expenseDefaultType, setExpenseDefaultType] = useState<ExpenseKind>('general');
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ member_search: '', amount: '', payment_method: 'cash', notes: '' });
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [duesOpen, setDuesOpen] = useState(true);
  const canEditPayments = can.viewFinancials(roles as any) && (roles as any[])?.some((r: any) => ['owner','admin'].includes(typeof r === 'string' ? r : r?.role));

  const openExpenseDrawer = (type: ExpenseKind) => { setExpenseDefaultType(type); setAddExpenseOpen(true); };

  useRealtimeInvalidate({
    channel: 'page-payments',
    tables: ['payments', 'invoices', 'payment_transactions', 'expenses'],
    invalidateKeys: [
      ['payments'],
      ['invoices'],
      ['all-overdue-invoices'],
      ['member-overdue-invoices'],
      ['expenses-console'],
      ['salary-advances'],
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
          id, invoice_number, total_amount, amount_paid, status, due_date, invoice_type, member_id, tax_amount, gst_rate,
          members(
            member_code, 
            profiles:user_id(full_name, phone, email, avatar_url), 
            lead:lead_id(full_name, phone, email, avatar_url),
            payments(payment_method, payment_date, status)
          ),
          invoice_items(description, quantity, unit_price)
        `)
        .in('status', ['pending', 'partial', 'overdue'])
        .order('due_date', { ascending: true })
        .limit(100);
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
        .select(`*, members(member_code, profiles:user_id(full_name, email, phone, avatar_url), lead:lead_id(full_name, email, phone, avatar_url)), invoices(invoice_number)`)
        .order('payment_date', { ascending: false })
        .limit(200);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Money-out feed — shares its cache key with <ExpensesTable /> so both stay in sync.
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses-console', branchFilter],
    queryFn: async () => {
      let query = supabase
        .from('expenses')
        .select('*, category:expense_categories(name)')
        .order('expense_date', { ascending: false })
        .limit(300);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ExpenseRow[];
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
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to void payment'),
  });

  const filteredPayments = useMemo(() => {
    return payments.filter((payment: any) => {
      if (searchTerm) {
        const memberName = resolveMemberDisplay(payment.members).name.toLowerCase();
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

  // Reversed rows (voided / refunded) stay visible for audit but never count
  // as money collected.
  const countable = filteredPayments.filter((p: any) => !isReversedPayment(p));
  const todayTotal = countable.filter((p: any) => new Date(p.payment_date).toDateString() === new Date().toDateString()).reduce((sum: number, p: any) => sum + p.amount, 0);
  const monthTotal = countable.reduce((sum: number, p: any) => sum + p.amount, 0);
  const completedTotal = countable.filter((p: any) => p.status === 'completed').reduce((sum: number, p: any) => sum + p.amount, 0);
  const pendingTotal = countable.filter((p: any) => p.status === 'pending').reduce((sum: number, p: any) => sum + p.amount, 0);
  const reversedTotal = filteredPayments.filter((p: any) => isReversedPayment(p)).reduce((sum: number, p: any) => sum + p.amount, 0);

  // Money out — same filter bar, applied to expenses
  const filteredExpenses = useMemo(() => {
    return (expenses as ExpenseRow[]).filter((e) => {
      if (searchTerm) {
        const hay = [e.description, e.vendor, e.bill_number, e.category?.name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(searchTerm.toLowerCase())) return false;
      }
      if (methodFilter !== 'all' && e.payment_method !== methodFilter) return false;
      if (dateRange?.from && dateRange?.to) {
        const d = new Date(e.expense_date);
        if (d < dateRange.from || d > dateRange.to) return false;
      }
      return true;
    });
  }, [expenses, searchTerm, methodFilter, dateRange]);

  const moneyOut = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const todayOut = filteredExpenses
    .filter((e) => new Date(e.expense_date).toDateString() === new Date().toDateString())
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netMovement = monthTotal - moneyOut;
  const unpaidBills = filteredExpenses.filter((e) => e.expense_type === 'vendor_bill' && !e.is_paid);

  const collectionsByMode = useMemo(() => {
    const map = new Map<string, number>();
    countable.forEach((p: any) => map.set(p.payment_method, (map.get(p.payment_method) || 0) + Number(p.amount || 0)));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [countable]);

  const spendByCategory = useMemo(() => {
    const map = new Map<string, number>();
    filteredExpenses.forEach((e) => {
      const key = e.category?.name || 'Uncategorised';
      map.set(key, (map.get(key) || 0) + Number(e.amount || 0));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filteredExpenses]);

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

  const downloadCsv = (headers: string[], rows: (string | number)[][], name: string) => {
    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name}-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportToCSV = () => {
    if (activeTab === 'expenses') {
      downloadCsv(
        ['Date', 'Description', 'Type', 'Vendor', 'Category', 'Amount', 'Mode', 'Reference', 'Bill No', 'Status'],
        filteredExpenses.map((e) => [
          format(new Date(e.expense_date), 'dd/MM/yyyy'), e.description, e.expense_type, e.vendor || '',
          e.category?.name || '', e.amount, e.payment_method || '', e.payment_reference || '', e.bill_number || '', e.status,
        ]),
        'expenses',
      );
      return;
    }
    downloadCsv(
      ['Date', 'Member', 'Amount', 'Method', 'Status', 'Invoice'],
      filteredPayments.map((p: any) => {
        const d = resolveMemberDisplay(p.members);
        const inv = p.invoices?.invoice_number || '-';
        const displayName = d.code ? `${d.name} (${d.code})` : d.name;
        return [format(new Date(p.payment_date), 'dd/MM/yyyy HH:mm'), displayName, p.amount, p.payment_method, p.status, inv];
      }),
      'payments',
    );
  };

  const openVoidDialog = (payment: any) => {
    setVoidingPayment(payment);
    setVoidDialogOpen(true);
  };

  const handleCollectFromDues = (invoice: any) => {
    setSelectedMember({
      id: invoice.member_id,
      full_name: resolveMemberDisplay(invoice.members).name,
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
              Money Movement
            </h1>
            <p className="text-muted-foreground mt-1">Collections, expenses, salary advances and outstanding dues in one console</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild className="rounded-xl"><Link to="/integrations/webhooks"><Activity className="h-4 w-4 mr-2" />Webhook Activity</Link></Button>
            <Button variant="outline" size="sm" onClick={() => openExpenseDrawer('salary_advance')} className="rounded-xl"><HandCoins className="h-4 w-4 mr-2" />Pay Advance</Button>
            <Button variant="outline" size="sm" onClick={() => openExpenseDrawer('general')} className="rounded-xl"><Receipt className="h-4 w-4 mr-2" />Add Expense</Button>
            <Button size="sm" onClick={() => setRecordPaymentOpen(true)} className="rounded-xl shadow-lg shadow-primary/20"><CreditCard className="h-4 w-4 mr-2" />Record Payment</Button>
            <Button variant="outline" size="sm" onClick={exportToCSV} className="rounded-xl"><Download className="h-4 w-4 mr-2" />Export</Button>
          </div>
        </div>

        {/* Money in / out / net — always visible, reflects the active filters */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <StatCard title="Money In (filtered)" value={`₹${monthTotal.toLocaleString('en-IN')}`} icon={ArrowUpRight} variant="success" />
          <StatCard title="Money Out (filtered)" value={`₹${moneyOut.toLocaleString('en-IN')}`} icon={ArrowDownRight} variant="accent" />
          <StatCard title="Net Movement" value={`₹${netMovement.toLocaleString('en-IN')}`} icon={Scale} variant={netMovement >= 0 ? 'default' : 'info'} />
          <StatCard title="Outstanding Dues" value={`₹${totalDues.toLocaleString('en-IN')}`} icon={AlertTriangle} variant="info" />
        </div>
        {reversedTotal > 0 && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Excludes ₹{reversedTotal.toLocaleString('en-IN')} in reversed entries (voided or refunded), which stay listed for audit.
          </p>
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
              <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search member, code, invoice, vendor or bill..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 rounded-xl" /></div>
              <DateRangeFilter onChange={(range) => setDateRange(range || undefined)} />
              <Select value={methodFilter} onValueChange={setMethodFilter}><SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Method" /></SelectTrigger><SelectContent><SelectItem value="all">All Methods</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="wallet">Wallet</SelectItem><SelectItem value="bank_transfer">Bank Transfer</SelectItem><SelectItem value="online">Online</SelectItem></SelectContent></Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="refunded">Refunded</SelectItem><SelectItem value="voided">Voided</SelectItem></SelectContent></Select>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="rounded-xl">
            <TabsTrigger value="overview" className="rounded-lg"><LayoutDashboard className="h-4 w-4 mr-1.5" />Overview</TabsTrigger>
            <TabsTrigger value="income" className="rounded-lg"><ArrowUpRight className="h-4 w-4 mr-1.5" />Income</TabsTrigger>
            <TabsTrigger value="expenses" className="rounded-lg"><Receipt className="h-4 w-4 mr-1.5" />Expenses</TabsTrigger>
            <TabsTrigger value="advances" className="rounded-lg"><HandCoins className="h-4 w-4 mr-1.5" />Advances</TabsTrigger>
            <TabsTrigger value="dues" className="rounded-lg"><AlertTriangle className="h-4 w-4 mr-1.5" />Dues{overdueInvoices.length > 0 && <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold text-warning">{overdueInvoices.length}</span>}</TabsTrigger>
          </TabsList>

          {/* ── Overview ─────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="pb-3"><CardTitle className="text-base">Collected today · ₹{todayTotal.toLocaleString('en-IN')}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {collectionsByMode.length === 0 && <p className="text-sm text-muted-foreground">No collections in this range.</p>}
                  {collectionsByMode.map(([mode, amt]) => (
                    <div key={mode} className="flex items-center justify-between">
                      <Badge className={getMethodColor(mode)}>{mode.replace('_', ' ')}</Badge>
                      <span className="font-semibold">₹{amt.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t text-sm text-muted-foreground flex justify-between">
                    <span>Pending / uncleared</span><span>₹{pendingTotal.toLocaleString('en-IN')}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/50 shadow-lg">
                <CardHeader className="pb-3"><CardTitle className="text-base">Spent today · ₹{todayOut.toLocaleString('en-IN')}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {spendByCategory.length === 0 && <p className="text-sm text-muted-foreground">No expenses in this range.</p>}
                  {spendByCategory.map(([cat, amt]) => (
                    <div key={cat} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{cat}</span>
                      <span className="font-semibold">₹{amt.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                  {unpaidBills.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('expenses')}
                      className="w-full mt-2 flex items-center justify-between rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>{unpaidBills.length} vendor bill{unpaidBills.length > 1 ? 's' : ''} unpaid</span>
                      <span className="font-semibold">₹{unpaidBills.reduce((s, b) => s + Number(b.amount || 0), 0).toLocaleString('en-IN')}</span>
                    </button>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Expenses ─────────────────────────────────────────── */}
          <TabsContent value="expenses">
            <ExpensesTable
              branchId={branchFilter}
              search={searchTerm}
              dateRange={dateRange}
              methodFilter={methodFilter}
              statusFilter={statusFilter}
              canEdit={canEditPayments}
              onEdit={(e) => setEditingExpense(e)}
            />
          </TabsContent>

          {/* ── Advances ─────────────────────────────────────────── */}
          <TabsContent value="advances">
            <AdvancesTable branchId={branchFilter} search={searchTerm} />
          </TabsContent>

          {/* ── Dues ─────────────────────────────────────────────── */}
          <TabsContent value="dues">
            <Card className="rounded-2xl border-warning/30 bg-warning/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-warning/20">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Dues Collection</CardTitle>
                    <p className="text-sm text-muted-foreground">{overdueInvoices.length} pending invoices • Total: ₹{totalDues.toLocaleString('en-IN')}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-[520px] overflow-y-auto">
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
                        const grouped = new Map<string, { 
                          name: string; 
                          code: string; 
                          invoices: any[]; 
                          total: number; 
                          earliest: Date | null;
                          lastPayment: { method: string; date: string } | null;
                        }>();
                        
                        for (const inv of overdueInvoices as any[]) {
                          const key = inv.member_id || inv.id;
                          const due = (inv.total_amount || 0) - (inv.amount_paid || 0);
                          
                          // Resolve last payment from the joined payments on member
                          const memberPayments = inv.members?.payments || [];
                          const lastP = memberPayments
                            .filter((p: any) => p.status === 'completed')
                            .sort((a: any, b: any) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime())[0];

                          const existing = grouped.get(key) || {
                            name: resolveMemberDisplay(inv.members).name,
                            code: inv.members?.member_code || '',
                            invoices: [],
                            total: 0,
                            earliest: null,
                            lastPayment: lastP ? { method: lastP.payment_method, date: lastP.payment_date } : null,
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
                            <Collapsible key={key} asChild>
                              <>
                                <TableRow className="hover:bg-muted/30 transition-colors">
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      <CollapsibleTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full shrink-0">
                                          <ChevronDown className="h-4 w-4 transition-transform duration-200" />
                                        </Button>
                                      </CollapsibleTrigger>
                                      <div>
                                        <p className="font-semibold text-slate-900">{g.name}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1 rounded">{g.code}</span>
                                          {g.lastPayment && (
                                            <Badge variant="outline" className="text-[10px] py-0 h-4 border-slate-200 bg-white gap-1 font-normal text-slate-500">
                                              <History className="h-2.5 w-2.5" />
                                              Last: {g.lastPayment.method}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border-indigo-100">
                                      {g.invoices.length} {g.invoices.length > 1 ? 'Bills' : 'Bill'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="font-bold text-destructive text-base">₹{g.total.toLocaleString('en-IN')}</TableCell>
                                  <TableCell>
                                    {g.earliest ? (
                                      <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium", 
                                        isOverdue ? "bg-red-50 text-red-700 border border-red-100" : "bg-slate-50 text-slate-600 border border-slate-100")}>
                                        <Clock className="h-3 w-3" />
                                        {format(g.earliest, 'dd MMM')}
                                      </div>
                                    ) : '-'}
                                  </TableCell>
                                  <TableCell>
                                    <Button size="sm" className="gap-1.5 text-xs h-8 px-3 rounded-lg shadow-sm" onClick={() => handleCollectFromDues(g.invoices[0])}>
                                      <CreditCard className="h-3.5 w-3.5" />Record
                                    </Button>
                                  </TableCell>
                                </TableRow>
                                <CollapsibleContent asChild>
                                  <TableRow className="bg-muted/20 border-t-0 hover:bg-muted/20">
                                    <TableCell colSpan={5} className="py-3 px-12">
                                      <div className="space-y-3">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                          < Receipt className="h-3 w-3" /> Outstanding Breakdown
                                        </p>
                                        <div className="grid gap-2">
                                          {g.invoices.map((inv: any) => {
                                            const balance = (inv.total_amount || 0) - (inv.amount_paid || 0);
                                            const isGst = (inv.tax_amount || 0) > 0 || (inv.gst_rate || 0) > 0;
                                            return (
                                              <div key={inv.id} className="flex items-start justify-between p-3 rounded-xl bg-white border border-slate-200/60 shadow-sm">
                                                <div className="space-y-1">
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-sm font-semibold text-slate-800">#{inv.invoice_number}</span>
                                                    {isGst ? (
                                                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] h-4 py-0 font-medium">GST INVOICE</Badge>
                                                    ) : (
                                                      <Badge variant="outline" className="text-[9px] h-4 py-0 font-medium text-slate-400 border-slate-200">CASH / NON-TAX</Badge>
                                                    )}
                                                  </div>
                                                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                                    {(inv.invoice_items || []).map((item: any, i: number) => (
                                                      <div key={i} className="text-xs text-slate-500 flex items-center gap-1.5 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">
                                                        <Tag className="h-2.5 w-2.5 opacity-60" />
                                                        {item.description}
                                                        <span className="text-[10px] opacity-60">x{item.quantity}</span>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                  <div className="text-sm font-bold text-destructive">₹{balance.toLocaleString('en-IN')}</div>
                                                  <div className="text-[10px] text-muted-foreground mt-0.5">Due {inv.due_date ? format(new Date(inv.due_date), 'dd MMM yy') : 'N/A'}</div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                </CollapsibleContent>
                              </>
                            </Collapsible>
                          );
                        });
                      })()}
                      {overdueInvoices.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                            No outstanding dues. Everything is collected.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Income ───────────────────────────────────────────── */}
          <TabsContent value="income">
        <Card className="rounded-2xl border-border/50 shadow-lg">

          <CardHeader><CardTitle>{hasActiveFilters ? `Filtered Payments (${filteredPayments.length})` : `Recent Payments (${payments.length})`}</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (<TableSkeleton rows={8} columns={isAdminOrOwner ? 7 : 6} />) : (
              <Table>
                <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Gross</TableHead><TableHead>Channel</TableHead><TableHead>Settlement</TableHead><TableHead>Status</TableHead><TableHead>Invoice</TableHead><TableHead>Paid on</TableHead>{isAdminOrOwner && <TableHead>Actions</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {filteredPayments.map((payment: any) => {
                    const isVoided = payment.status === 'voided';
                    const isReversed = isReversedPayment(payment);
                    const d = resolveMemberDisplay(payment.members);
                    return (
                      <TableRow key={payment.id} className={isReversed ? 'opacity-60' : ''}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className={`font-medium ${isReversed ? 'line-through' : ''}`}>{d.name}</span>
                            {d.code && <span className="text-xs text-muted-foreground">{d.code}</span>}
                          </div>
                        </TableCell>
                        <TableCell className={`font-medium ${isReversed ? 'line-through' : ''}`}>₹{payment.amount.toLocaleString()}</TableCell>
                        <TableCell><Badge className={getMethodColor(payment.payment_method)}>{paymentChannelLabel(payment)}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {isReversed ? (
                            <span className="text-muted-foreground">Not collected</span>
                          ) : payment.payment_source === 'razorpay' ? (
                            <div><p>Net ₹{Number(payment.net_settlement_amount ?? payment.amount).toLocaleString('en-IN')}</p><p className="text-muted-foreground">Fee + tax ₹{gatewayDeduction(payment).toLocaleString('en-IN')}</p></div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(payment.status)}>{reversalLabel(payment) ?? payment.status}</Badge>
                          {isReversed && (
                            <p className="mt-1 text-[11px] italic text-muted-foreground">{reversalCaption(payment)}</p>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {payment.invoices?.invoice_number ? (
                            <Link
                              to={`/invoices?focus=${payment.invoice_id}`}
                              className="text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            >
                              {payment.invoices.invoice_number}
                            </Link>
                          ) : '-'}
                        </TableCell>
                        <TableCell>{format(new Date(payment.payment_date), 'dd MMM yyyy HH:mm')}</TableCell>
                        {isAdminOrOwner && (
                          <TableCell>
                            {!isReversed && payment.status !== 'failed' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={canEditPayments ? '' : 'text-destructive hover:text-destructive'}
                                onClick={() => openVoidDialog(payment)}
                              >
                                {canEditPayments
                                  ? (<><Pencil className="h-4 w-4 mr-1" /> Edit</>)
                                  : (<><Ban className="h-4 w-4 mr-1" /> Void</>)}
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
                      <TableCell colSpan={isAdminOrOwner ? 8 : 7} className="text-center py-16 text-muted-foreground">
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
          </TabsContent>
        </Tabs>
      </div>


      {/* Edit / Void Payment — side drawer (no center dialogs for forms) */}
      <PaymentEditDrawer
        open={voidDialogOpen}
        onOpenChange={(o) => { setVoidDialogOpen(o); if (!o) setVoidingPayment(null); }}
        payment={voidingPayment}
        canEdit={canEditPayments}
      />

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

      {/* Add Expense / Pay Advance Drawer */}
      {branchFilter && (
        <AddExpenseDrawer
          open={addExpenseOpen}
          onOpenChange={setAddExpenseOpen}
          branchId={branchFilter}
          defaultType={expenseDefaultType}
        />
      )}

      {/* Edit Expense — owner/admin correction with mandatory reason */}
      <EditExpenseDrawer
        open={!!editingExpense}
        onOpenChange={(o) => { if (!o) setEditingExpense(null); }}
        expense={editingExpense}
      />

    </AppLayout>
  );
}
