import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreateInvoiceDrawer } from '@/components/invoices/CreateInvoiceDrawer';
import { InvoiceViewDrawer } from '@/components/invoices/InvoiceViewDrawer';
import { RecordPaymentDrawer } from '@/components/invoices/RecordPaymentDrawer';
import { SendPaymentLinkDrawer } from '@/components/invoices/SendPaymentLinkDrawer';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { InvoiceShareDrawer } from '@/components/invoices/InvoiceShareDrawer';
import { CancelInvoiceDrawer } from '@/components/invoices/CancelInvoiceDrawer';
import { CorrectInvoiceDrawer } from '@/components/invoices/CorrectInvoiceDrawer';
import { SetInvoiceDueDateDrawer } from '@/components/invoices/SetInvoiceDueDateDrawer';
import {
  FileText, Plus, Users, DollarSign, TrendingUp, Clock, Search, MoreHorizontal, Eye, Download, Send, Mail,
  ChevronLeft, ChevronRight, ShoppingCart, ClipboardList, Dumbbell, PlusCircle, ReceiptText, Undo2, XCircle,
  IndianRupee, Pencil, CalendarRange, CalendarClock
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  format, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter,
  subQuarters, startOfYear, endOfYear, subDays, startOfDay, endOfDay,
} from 'date-fns';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';
import { downloadBlob } from '@/utils/pdfBlob';
import { generateInvoicePdfBlob } from '@/utils/invoicePdf';

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<any>(null);
  const [paymentLinkInvoice, setPaymentLinkInvoice] = useState<any>(null);
  const [shareInvoice, setShareInvoice] = useState<any>(null);
  const [cancelInvoice, setCancelInvoiceTarget] = useState<any>(null);
  const [correctInvoice, setCorrectInvoiceTarget] = useState<any>(null);
  const [dueDateInvoice, setDueDateInvoice] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Renewal offers (proformas) are not statutory invoices — hidden by default
  const [docFilter, setDocFilter] = useState<'invoices' | 'offers' | 'all'>('invoices');
  const [periodFilter, setPeriodFilter] = useState<string>('this_month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const { branchFilter, effectiveBranchId } = useBranchContext();
  const { roles } = useAuth() as any;
  const canCancel = can.cancelInvoice(roles);
  const canCorrect = can.cancelInvoice(roles) || can.approveDiscount(roles);

  // Realtime subscription for invoice status updates
  useEffect(() => {
    if (!branchFilter) return;
    const channel = supabase
      .channel('invoices-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'invoices',
        filter: `branch_id=eq.${branchFilter}`,
      }, (payload) => {
        const newStatus = payload.new?.status;
        const invoiceNum = payload.new?.invoice_number;
        if (newStatus === 'paid' && payload.old?.status !== 'paid') {
          toast.success(`✅ Invoice ${invoiceNum || ''} marked as Paid`);
        }
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [branchFilter, queryClient]);

  // Cmd+K: ?new=1 opens Create Invoice drawer
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setCreateOpen(true);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Deep-link: /invoices?invoice=<id> auto-opens that invoice's view drawer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invoiceId = params.get('invoice');
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, status, total_amount, amount_paid, due_date, created_at, member_id, pos_sale_id, branch_id,
          members(member_code, profiles:user_id(full_name, email, phone, avatar_url), lead:lead_id(full_name, email, phone, avatar_url)),
          invoice_items(description, reference_type)
        `)
        .eq('id', invoiceId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error('Invoice link could not be opened — invoice not found');
        const url = new URL(window.location.href);
        url.searchParams.delete('invoice');
        window.history.replaceState({}, '', url.toString());
        return;
      }
      setViewInvoice(data);
    })();
    return () => { cancelled = true; };
  // Run once on mount; subsequent navigations within the page won't change ?invoice=
   
  }, []);

  // Strip ?invoice= from the URL whenever the view drawer closes so a refresh
  // doesn't re-open it.
  const closeViewInvoice = () => {
    setViewInvoice(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has('invoice')) {
      url.searchParams.delete('invoice');
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Reset page on filter changes
  const handleStatusChange = (val: string) => { setStatusFilter(val); setPage(0); };
  const handleSearchChange = (val: string) => { setSearchTerm(val); setPage(0); };
  const handlePeriodChange = (val: string) => { setPeriodFilter(val); setPage(0); };

  // ---- Date range resolution (drives BOTH the list and the KPI cards) ----
  const now = new Date();
  const range: { from: Date | null; to: Date | null; label: string } = (() => {
    switch (periodFilter) {
      case 'today':
        return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };
      case 'last_7':
        return { from: startOfDay(subDays(now, 6)), to: endOfDay(now), label: 'Last 7 days' };
      case 'last_30':
        return { from: startOfDay(subDays(now, 29)), to: endOfDay(now), label: 'Last 30 days' };
      case 'this_month':
        return { from: startOfMonth(now), to: endOfMonth(now), label: format(now, 'MMMM yyyy') };
      case 'last_month': {
        const d = subMonths(now, 1);
        return { from: startOfMonth(d), to: endOfMonth(d), label: format(d, 'MMMM yyyy') };
      }
      case 'this_quarter':
        return { from: startOfQuarter(now), to: endOfQuarter(now), label: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}` };
      case 'last_quarter': {
        const d = subQuarters(now, 1);
        return { from: startOfQuarter(d), to: endOfQuarter(d), label: `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}` };
      }
      case 'this_year':
        return { from: startOfYear(now), to: endOfYear(now), label: format(now, 'yyyy') };
      case 'custom': {
        if (!customFrom && !customTo) return { from: null, to: null, label: 'Custom range' };
        const f = customFrom ? startOfDay(new Date(customFrom)) : null;
        const t = customTo ? endOfDay(new Date(customTo)) : null;
        return {
          from: f,
          to: t,
          label: `${f ? format(f, 'd MMM yyyy') : '…'} – ${t ? format(t, 'd MMM yyyy') : '…'}`,
        };
      }
      default:
        return { from: null, to: null, label: 'All time' };
    }
  })();

  const rangeKey = `${range.from?.toISOString() ?? ''}_${range.to?.toISOString() ?? ''}`;

  const applyFilters = (q: any) => {
    if (branchFilter) q = q.eq('branch_id', branchFilter);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter as any);
    if (docFilter === 'invoices') q = q.eq('is_proforma', false);
    if (docFilter === 'offers') q = q.eq('is_proforma', true);
    if (range.from) q = q.gte('created_at', range.from.toISOString());
    if (range.to) q = q.lte('created_at', range.to.toISOString());
    return q;
  };

  // When a search term is present we bypass pagination and scan a wide window
  // server-side, so an invoice number on page 3 is still findable.
  const isSearching = searchTerm.trim().length > 0;
  const SEARCH_SCAN_LIMIT = 500;

  // Converts a renewal offer (proforma) into a real GST tax invoice on demand
  const issueTaxInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.rpc('convert_proforma_to_invoice', { _invoice_id: invoiceId });
      if (error) throw error;
      return data as { invoice_number?: string };
    },
    onSuccess: (res) => {
      toast.success(`Tax invoice issued${res?.invoice_number ? ` — ${res.invoice_number}` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-stats'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Could not issue the tax invoice'),
  });

  const { data: invoicesResult, isLoading } = useQuery({
    queryKey: ['invoices', branchFilter, statusFilter, docFilter, rangeKey, isSearching ? 'search' : page],
    queryFn: async () => {
      const query = applyFilters(
        supabase
          .from('invoices')
          .select(`
            id, invoice_number, status, total_amount, amount_paid, due_date, created_at, member_id, pos_sale_id, branch_id, is_proforma, document_series,
            members(member_code, profiles:user_id(full_name, email, phone, avatar_url), lead:lead_id(full_name, email, phone, avatar_url)),
            invoice_items(description, reference_type)
          `, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(
            isSearching ? 0 : page * PAGE_SIZE,
            isSearching ? SEARCH_SCAN_LIMIT - 1 : (page + 1) * PAGE_SIZE - 1,
          ),
      );

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data || [], count };
    },
  });

  // Range-accurate KPI aggregates — status filter intentionally NOT applied so
  // paid/unpaid totals stay meaningful, only branch + date range scope them.
  const { data: rangeStats, isLoading: statsLoading } = useQuery({
    queryKey: ['invoice-stats', branchFilter, rangeKey],
    queryFn: async () => {
      let q = supabase
        .from('invoices')
        .select('id, member_id, status, total_amount, amount_paid, created_at')
        .eq('is_proforma', false)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      if (range.from) q = q.gte('created_at', range.from.toISOString());
      if (range.to) q = q.lte('created_at', range.to.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []).filter((r: any) => r.status !== 'cancelled');
      return {
        totalClients: new Set(rows.map((r: any) => r.member_id).filter(Boolean)).size,
        totalInvoices: rows.length,
        billedAmount: rows.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0),
        paidAmount: rows.reduce((s: number, r: any) => s + Number(r.amount_paid || 0), 0),
        unpaidAmount: rows.reduce(
          (s: number, r: any) => s + Math.max(0, Number(r.total_amount || 0) - Number(r.amount_paid || 0)),
          0,
        ),
        openCount: rows.filter((r: any) => Number(r.total_amount || 0) - Number(r.amount_paid || 0) > 0).length,
      };
    },
  });

  const invoices = invoicesResult?.data || [];
  const totalCount = invoicesResult?.count;
  const totalPages = isSearching || !totalCount ? null : Math.ceil(totalCount / PAGE_SIZE);


  const getInvoiceType = (invoice: any): { label: string; icon: typeof FileText; variant: 'default' | 'secondary' | 'outline' | 'destructive' } => {
    if (invoice.pos_sale_id) return { label: 'POS', icon: ShoppingCart, variant: 'secondary' };
    const items = invoice.invoice_items || [];
    const firstItem = items[0];
    if (!firstItem) return { label: 'Manual', icon: ReceiptText, variant: 'outline' };
    const refType = firstItem.reference_type || '';
    const desc = (firstItem.description || '').toLowerCase();
    if (refType === 'membership_refund' || invoice.total_amount < 0) return { label: 'Refund', icon: Undo2, variant: 'destructive' };
    if (desc.includes('top-up') || desc.includes('top up') || desc.includes('add-on')) return { label: 'Add-On', icon: PlusCircle, variant: 'default' };
    if (refType === 'pt_package' || desc.includes('pt ')) return { label: 'PT', icon: Dumbbell, variant: 'secondary' };
    if (refType === 'membership') return { label: 'Membership', icon: ClipboardList, variant: 'outline' };
    return { label: 'Manual', icon: ReceiptText, variant: 'outline' };
  };

  // Search across the wide scan window (invoice number, member name, member code)
  const filteredInvoices = invoices.filter((invoice: any) => {
    if (!isSearching) return true;
    const q = searchTerm.trim().toLowerCase();
    const memberName = resolveMemberDisplay(invoice.members, invoice.customer_name).name;
    return memberName.toLowerCase().includes(q) ||
      (invoice.invoice_number || '').toLowerCase().includes(q) ||
      (invoice.members?.member_code || '').toLowerCase().includes(q);
  });


  // KPI values come from the range-scoped aggregate query (never the page slice)
  const stats = rangeStats ?? {
    totalClients: 0, totalInvoices: 0, billedAmount: 0, paidAmount: 0, unpaidAmount: 0, openCount: 0,
  };
  const collectionRate = stats.billedAmount > 0
    ? Math.round((stats.paidAmount / stats.billedAmount) * 100)
    : 0;
  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      paid: 'bg-success/10 text-success border-success/20',
      pending: 'bg-warning/10 text-warning border-warning/20',
      partial: 'bg-info/10 text-info border-info/20',
      overdue: 'bg-destructive/10 text-destructive border-destructive/20',
      cancelled: 'bg-muted text-muted-foreground border-border',
    };
    return colors[status] || 'bg-muted text-muted-foreground border-border';
  };

  const exportInvoicesCSV = () => {
    const headers = ['Invoice #', 'Client', 'Type', 'Total', 'Paid', 'Balance', 'Status', 'Date'];
    const rows = filteredInvoices.map((inv: any) => {
      const t = getInvoiceType(inv);
      return [
        inv.invoice_number,
        resolveMemberDisplay(inv.members, inv.customer_name).name,
        t.label,
        inv.total_amount,
        inv.amount_paid || 0,
        inv.total_amount - (inv.amount_paid || 0),
        inv.status,
        format(new Date(inv.created_at), 'dd/MM/yyyy'),
      ];
    });
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `invoices-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    window.URL.revokeObjectURL(url);
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'W';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Invoices</h1>
            <p className="text-muted-foreground mt-1">Manage and track all invoices</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportInvoicesCSV} className="rounded-xl">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="bg-accent hover:bg-accent/90">
              <Plus className="mr-2 h-4 w-4" />
              Create Invoice
            </Button>
          </div>
        </div>

        {/* Period scope + KPI strip */}
        <div className="rounded-2xl border bg-card p-4 shadow-lg shadow-primary/5 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CalendarRange className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Showing</p>
                <p className="font-semibold text-foreground">{range.label}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={periodFilter} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[190px] rounded-xl" aria-label="Date range">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="last_7">Last 7 days</SelectItem>
                  <SelectItem value="last_30">Last 30 days</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="last_month">Last month</SelectItem>
                  <SelectItem value="this_quarter">This quarter</SelectItem>
                  <SelectItem value="last_quarter">Last quarter</SelectItem>
                  <SelectItem value="this_year">This year</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {periodFilter === 'custom' && (
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="inv-from">From date</label>
                  <Input
                    id="inv-from" type="date" value={customFrom}
                    onChange={(e) => { setCustomFrom(e.target.value); setPage(0); }}
                    className="w-[150px] rounded-xl"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <label className="sr-only" htmlFor="inv-to">To date</label>
                  <Input
                    id="inv-to" type="date" value={customTo}
                    onChange={(e) => { setCustomTo(e.target.value); setPage(0); }}
                    className="w-[150px] rounded-xl"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Billed', value: inr(stats.billedAmount), sub: `${stats.totalInvoices} invoices`, icon: FileText, tone: 'text-primary bg-primary/10' },
              { label: 'Collected', value: inr(stats.paidAmount), sub: `${collectionRate}% of billed`, icon: TrendingUp, tone: 'text-success bg-success/10' },
              { label: 'Outstanding', value: inr(stats.unpaidAmount), sub: `${stats.openCount} open`, icon: Clock, tone: 'text-warning bg-warning/10' },
              { label: 'Clients billed', value: String(stats.totalClients), sub: 'unique members', icon: Users, tone: 'text-info bg-info/10' },
              { label: 'Avg invoice', value: inr(stats.totalInvoices ? stats.billedAmount / stats.totalInvoices : 0), sub: 'per invoice', icon: IndianRupee, tone: 'text-accent bg-accent/10' },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border bg-background p-4 transition-all duration-200 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${kpi.tone}`}>
                    <kpi.icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                {statsLoading ? (
                  <div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{kpi.value}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by invoice #, member name or code..."
                  className="pl-10 rounded-xl"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-[180px] rounded-xl" aria-label="Status filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>

              <Select value={docFilter} onValueChange={(v) => { setDocFilter(v as typeof docFilter); setPage(0); }}>
                <SelectTrigger className="w-[190px] rounded-xl" aria-label="Document type filter">
                  <SelectValue placeholder="Document type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoices">Invoices only</SelectItem>
                  <SelectItem value="offers">Renewal offers</SelectItem>
                  <SelectItem value="all">All documents</SelectItem>
                </SelectContent>
              </Select>

            </div>
          </CardContent>
        </Card>

        {/* Invoice List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Invoice List</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <TableSkeleton rows={8} columns={9} />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[250px]">Client</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Paid</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInvoices.map((invoice: any) => {
                        const display = resolveMemberDisplay(invoice.members, invoice.customer_name);
                        const memberName = display.name;
                        const balance = invoice.total_amount - (invoice.amount_paid || 0);
                        
                        return (
                          <TableRow key={invoice.id} className="group">
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarImage src={display.avatar_url ?? undefined} />
                                  <AvatarFallback className="bg-accent/10 text-accent font-semibold">
                                    {getInitials(memberName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium">{memberName}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {display.code || 'Guest'}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-sm">{invoice.invoice_number}</span>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const t = getInvoiceType(invoice);
                                const Icon = t.icon;
                                return (
                                  <Badge variant={t.variant} className="gap-1">
                                    <Icon className="h-3 w-3" />
                                    {t.label}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="font-semibold">
                              ₹{invoice.total_amount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-success">
                              ₹{(invoice.amount_paid || 0).toLocaleString()}
                            </TableCell>
                            <TableCell className={balance > 0 ? 'text-destructive' : ''}>
                              ₹{balance.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(invoice.created_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge className={`${getStatusColor(invoice.status)} border`}>
                                  {invoice.status}
                                </Badge>
                                {invoice.is_proforma && (
                                  <Badge variant="outline" className="border-primary/30 text-primary">Renewal offer</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setViewInvoice(invoice)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        toast.loading('Preparing invoice PDF…', { id: `dl-${invoice.id}` });
                                        const blob = await generateInvoicePdfBlob(invoice.id);
                                        downloadBlob(blob, `Invoice-${invoice.invoice_number}.pdf`);
                                        toast.success('Invoice downloaded', { id: `dl-${invoice.id}` });
                                      } catch (e: any) {
                                        console.error('Invoice download failed:', e);
                                        toast.error(e?.message || 'Could not download invoice', { id: `dl-${invoice.id}` });
                                      }
                                    }}
                                  >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                    const d = resolveMemberDisplay(invoice.members, invoice.customer_name);
                                    setPaymentLinkInvoice({
                                      id: invoice.id,
                                      invoice_number: invoice.invoice_number,
                                      total_amount: invoice.total_amount,
                                      amount_paid: invoice.amount_paid || 0,
                                      member_name: d.name,
                                      member_phone: d.phone,
                                      member_email: d.email,
                                      branch_id: invoice.branch_id,
                                    });
                                  }}>
                                    <Send className="mr-2 h-4 w-4" />
                                    Send Payment Link
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setShareInvoice(invoice)}>
                                    <Mail className="mr-2 h-4 w-4" />
                                    Share Invoice
                                  </DropdownMenuItem>
                                  {balance > 0 && invoice.status !== 'cancelled' && (
                                    <DropdownMenuItem onClick={() => setPaymentInvoice(invoice)}>
                                      <IndianRupee className="mr-2 h-4 w-4" />
                                      Record Payment
                                    </DropdownMenuItem>
                                  )}
                                  {canCorrect && invoice.is_proforma && invoice.status !== 'cancelled' && (
                                    <DropdownMenuItem onClick={() => issueTaxInvoice.mutate(invoice.id)}>
                                      <FileCheck className="mr-2 h-4 w-4" />
                                      Issue Tax Invoice
                                    </DropdownMenuItem>
                                  )}
                                  {canCorrect && invoice.status !== 'cancelled' && balance > 0 && (
                                    <DropdownMenuItem onClick={() => setDueDateInvoice(invoice)}>
                                      <CalendarClock className="mr-2 h-4 w-4" />
                                      Set Due Date
                                    </DropdownMenuItem>
                                  )}
                                  {canCorrect && invoice.status !== 'cancelled' && invoice.status !== 'refunded' && (
                                    <DropdownMenuItem onClick={() => setCorrectInvoiceTarget(invoice)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Correct Amount
                                    </DropdownMenuItem>
                                  )}
                                  {canCancel && invoice.status !== 'cancelled' && invoice.status !== 'refunded' && (
                                    <DropdownMenuItem
                                      onClick={() => setCancelInvoiceTarget(invoice)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <XCircle className="mr-2 h-4 w-4" />
                                      Cancel Invoice
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredInvoices.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                            <div className="flex flex-col items-center gap-3">
                              <div className="h-16 w-16 rounded-full bg-muted/80 flex items-center justify-center">
                                <FileText className="h-8 w-8 opacity-40" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground/70">No invoices found</p>
                                <p className="text-sm mt-1">
                                  {searchTerm || statusFilter !== 'all'
                                    ? 'Try adjusting your search or filters'
                                    : 'Create your first invoice to get started'}
                                </p>
                              </div>
                              {!searchTerm && statusFilter === 'all' && (
                                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="mt-2">
                                  <Plus className="h-4 w-4 mr-1" /> Create Invoice
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination Controls */}
                {totalPages !== null && totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount || 0)} of {totalCount} invoices
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <span className="text-sm font-medium px-2">
                        Page {page + 1} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= totalPages - 1}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateInvoiceDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        branchId={effectiveBranchId || ''}
      />

      {viewInvoice && (
        <InvoiceViewDrawer
          open={!!viewInvoice}
          onOpenChange={(open) => !open && closeViewInvoice()}
          invoiceId={viewInvoice.id}
          onRecordPayment={() => {
            setPaymentInvoice(viewInvoice);
            closeViewInvoice();
          }}
        />
      )}

      <RecordPaymentDrawer
        open={!!paymentInvoice}
        onOpenChange={(open) => !open && setPaymentInvoice(null)}
        invoice={paymentInvoice}
        branchId={paymentInvoice?.branch_id || effectiveBranchId || ''}
      />

      <SendPaymentLinkDrawer
        open={!!paymentLinkInvoice}
        onOpenChange={(open) => !open && setPaymentLinkInvoice(null)}
        invoice={paymentLinkInvoice}
      />

      <InvoiceShareDrawer
        open={!!shareInvoice}
        onOpenChange={(open) => !open && setShareInvoice(null)}
        invoice={shareInvoice}
      />

      <CancelInvoiceDrawer
        open={!!cancelInvoice}
        onOpenChange={(open) => !open && setCancelInvoiceTarget(null)}
        invoice={cancelInvoice}
      />

      <SetInvoiceDueDateDrawer
        open={!!dueDateInvoice}
        onOpenChange={(open) => !open && setDueDateInvoice(null)}
        invoice={dueDateInvoice}
      />

      <CorrectInvoiceDrawer
        open={!!correctInvoice}
        onOpenChange={(open) => !open && setCorrectInvoiceTarget(null)}
        invoice={correctInvoice}
        onCorrected={() => queryClient.invalidateQueries({ queryKey: ['invoices'] })}
      />
    </AppLayout>
  );
}
