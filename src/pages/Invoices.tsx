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
import { 
  FileText, Plus, Users, DollarSign, TrendingUp, Clock, Search, MoreHorizontal, Eye, Download, Send, Mail,
  ChevronLeft, ChevronRight, ShoppingCart, ClipboardList, Dumbbell, PlusCircle, ReceiptText, Undo2
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<any>(null);
  const [paymentLinkInvoice, setPaymentLinkInvoice] = useState<any>(null);
  const [shareInvoice, setShareInvoice] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const { branchFilter, effectiveBranchId } = useBranchContext();

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
          members(member_code, profiles:user_id(full_name, email, phone, avatar_url)),
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

  const { data: invoicesResult, isLoading } = useQuery({
    queryKey: ['invoices', branchFilter, statusFilter, page],
    queryFn: async () => {
      let query = supabase
        .from('invoices')
        .select(`
          id, invoice_number, status, total_amount, amount_paid, due_date, created_at, member_id, pos_sale_id, branch_id,
          members(member_code, profiles:user_id(full_name, email, phone, avatar_url)),
          invoice_items(description, reference_type)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (branchFilter) query = query.eq('branch_id', branchFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data || [], count };
    },
  });

  const invoices = invoicesResult?.data || [];
  const totalCount = invoicesResult?.count;
  const totalPages = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : null;

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

  // Client-side search filter (search is lightweight on paginated data)
  const filteredInvoices = invoices.filter((invoice: any) => {
    if (!searchTerm) return true;
    const memberName = invoice.members?.profiles?.full_name || '';
    return memberName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.invoice_number.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Stats from current page (approximate for paginated view)
  const stats = {
    totalClients: new Set(invoices.map((i: any) => i.member_id).filter(Boolean)).size,
    totalInvoices: totalCount || invoices.length,
    paidAmount: invoices.filter((i: any) => i.status === 'paid').reduce((sum: number, i: any) => sum + i.total_amount, 0),
    unpaidAmount: invoices.filter((i: any) => i.status !== 'paid' && i.status !== 'cancelled').reduce((sum: number, i: any) => sum + (i.total_amount - (i.amount_paid || 0)), 0),
  };

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
        inv.members?.profiles?.full_name || inv.customer_name || 'Walk-in',
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

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Clients</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.totalClients}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                  <Users className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-info to-info/80 text-info-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Invoices</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.totalInvoices}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-info-foreground/20 flex items-center justify-center">
                  <FileText className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-success to-success/80 text-success-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Paid</p>
                  <h3 className="text-3xl font-bold mt-1">₹{stats.paidAmount.toLocaleString()}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-success-foreground/20 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-warning to-warning/80 text-warning-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Unpaid</p>
                  <h3 className="text-3xl font-bold mt-1">₹{stats.unpaidAmount.toLocaleString()}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-warning-foreground/20 flex items-center justify-center">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by invoice # or member name..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
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
                        const memberName = invoice.members?.profiles?.full_name || invoice.customer_name || 'Walk-in Customer';
                        const balance = invoice.total_amount - (invoice.amount_paid || 0);
                        
                        return (
                          <TableRow key={invoice.id} className="group">
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarImage src={invoice.members?.profiles?.avatar_url} />
                                  <AvatarFallback className="bg-accent/10 text-accent font-semibold">
                                    {getInitials(memberName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium">{memberName}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {invoice.members?.member_code || 'Guest'}
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
                              <Badge className={`${getStatusColor(invoice.status)} border`}>
                                {invoice.status}
                              </Badge>
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
                                  <DropdownMenuItem>
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                    const memberProfile = (invoice.members as any)?.profiles;
                                    setPaymentLinkInvoice({
                                      id: invoice.id,
                                      invoice_number: invoice.invoice_number,
                                      total_amount: invoice.total_amount,
                                      amount_paid: invoice.amount_paid || 0,
                                      member_name: memberProfile?.full_name,
                                      member_phone: memberProfile?.phone,
                                      member_email: memberProfile?.email,
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
    </AppLayout>
  );
}
