import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, RefreshCw, Search, ShieldCheck, ShieldX, ShieldAlert, Webhook } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';

const GATEWAY_LABEL: Record<string, string> = {
  razorpay: 'Razorpay', phonepe: 'PhonePe', payu: 'PayU', ccavenue: 'CCAvenue', unknown: 'Unknown',
};

function StatusBadge({ status, httpStatus }: { status: string | null; httpStatus: number | null }) {
  const isOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  const cls = status === 'captured' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    : status === 'failed' || status === 'rejected' ? 'bg-destructive/10 text-destructive border-destructive/20'
    : status === 'authorized' || status === 'pending' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    : isOk ? 'bg-sky-500/10 text-sky-600 border-sky-500/20'
    : 'bg-muted text-muted-foreground';
  return <Badge variant="outline" className={cls}>{status || 'received'}</Badge>;
}

function SignatureBadge({ verified }: { verified: boolean | null }) {
  if (verified === true) return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1"><ShieldCheck className="h-3 w-3" />Verified</Badge>;
  if (verified === false) return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1"><ShieldX className="h-3 w-3" />Invalid</Badge>;
  return <Badge variant="outline" className="bg-muted text-muted-foreground gap-1"><ShieldAlert className="h-3 w-3" />Not checked</Badge>;
}

interface WebhookRow {
  id: string;
  branch_id: string;
  gateway: string;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  amount: number | null;
  status: string | null;
  signature_verified: boolean | null;
  http_status: number | null;
  error_message: string | null;
  event_type: string | null;
  source: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
  invoice_id: string | null;
  member_id: string | null;
  webhook_data: unknown;
  response_body: unknown;
  invoice?: {
    invoice_number: string | null;
    member_id: string | null;
    members?: {
      member_code: string | null;
      profiles?: { full_name: string | null } | null;
    } | null;
  } | null;
  member?: {
    member_code: string | null;
    profiles?: { full_name: string | null } | null;
  } | null;
}

const PAGE_SIZE = 50;

const HANDLED_STATUSES = new Set(['captured', 'authorized', 'failed', 'rejected']);

function deriveAction(r: WebhookRow): { label: string; tone: 'good' | 'bad' | 'warn' | 'muted' } {
  const okHttp = r.http_status !== null && r.http_status >= 200 && r.http_status < 300;
  if (r.signature_verified === false) return { label: 'Rejected — bad signature', tone: 'bad' };
  if (r.http_status && r.http_status >= 400) return { label: r.error_message ? `Rejected — ${r.error_message}` : `Rejected — HTTP ${r.http_status}`, tone: 'bad' };
  if (r.status === 'captured' && r.invoice_id) return { label: 'Marked invoice paid', tone: 'good' };
  if (r.status === 'captured') return { label: 'Captured (no invoice link)', tone: 'warn' };
  if (r.status === 'authorized') return { label: 'Authorised — awaiting capture', tone: 'warn' };
  if (r.status === 'failed' || r.status === 'rejected') return { label: 'Logged failure', tone: 'bad' };
  // Unhandled / unrecognized event — surface in red so operators can investigate.
  if (okHttp && r.status && !HANDLED_STATUSES.has(r.status)) {
    return { label: `Unhandled event — ${r.event_type || r.status}`, tone: 'bad' };
  }
  if (okHttp) return { label: 'Logged delivery', tone: 'muted' };
  return { label: r.status || 'Received', tone: 'muted' };
}

export function WebhookActivityPanel() {
  const { branchFilter } = useBranchContext();
  const qc = useQueryClient();
  const [gatewayFilter, setGatewayFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sigFilter, setSigFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [page, setPage] = useState(0);

  const { data: pageData, isLoading, refetch } = useQuery<{ rows: WebhookRow[]; count: number | null }>({
    queryKey: ['webhook-activity', branchFilter, gatewayFilter, statusFilter, sigFilter, dateFrom, dateTo, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from('payment_transactions')
        .select(
          `*,
           invoice:invoices!payment_transactions_invoice_id_fkey(invoice_number, member_id, members(member_code, profiles:user_id(full_name))),
           member:members!payment_transactions_member_id_fkey(member_code, profiles:user_id(full_name))`,
          { count: 'exact' },
        )
        .eq('source', 'webhook')
        .order('received_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      if (gatewayFilter !== 'all') q = q.eq('gateway', gatewayFilter);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (sigFilter === 'verified') q = q.eq('signature_verified', true);
      else if (sigFilter === 'invalid') q = q.eq('signature_verified', false);
      else if (sigFilter === 'unchecked') q = q.is('signature_verified', null);
      if (dateFrom) q = q.gte('received_at', new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
        q = q.lte('received_at', end.toISOString());
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data as unknown as WebhookRow[]) || [], count: count ?? null };
    },
    refetchInterval: 30000,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = pageData?.rows || [];
  const totalCount = pageData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Pre-fetch invoice statuses for rows that have an invoice link, so the
  // Reconcile button can be gated to invoices that are still pending.
  const invoiceIds = useMemo(
    () => Array.from(new Set(rows.map(r => r.invoice_id).filter((id): id is string => !!id))),
    [rows],
  );
  const { data: invoiceStatuses = {} } = useQuery<Record<string, string>>({
    queryKey: ['webhook-activity-invoice-status', invoiceIds],
    queryFn: async () => {
      if (invoiceIds.length === 0) return {};
      const { data } = await supabase.from('invoices').select('id, status').in('id', invoiceIds);
      const map: Record<string, string> = {};
      (data || []).forEach((r: { id: string; status: string }) => { map[r.id] = r.status; });
      return map;
    },
    enabled: invoiceIds.length > 0,
  });

  // Realtime subscription for live updates
  useEffect(() => {
    const ch = supabase
      .channel('webhook-activity-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => {
        qc.invalidateQueries({ queryKey: ['webhook-activity'] });
        qc.invalidateQueries({ queryKey: ['gateway-last-received'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Server-side filters cover gateway/status/signature/dates; search remains client-side
  // since it spans multiple text columns.
  const filtered = useMemo(() => {
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => {
      const memberName = r.invoice?.members?.profiles?.full_name || r.member?.profiles?.full_name || '';
      const memberCode = r.invoice?.members?.member_code || r.member?.member_code || '';
      const invoiceNum = r.invoice?.invoice_number || '';
      const hay = [
        r.gateway_order_id, r.gateway_payment_id, r.event_type, r.error_message,
        memberName, memberCode, invoiceNum,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [rows, search]);

  // Reset to first page when filters change
  useEffect(() => { setPage(0); }, [gatewayFilter, statusFilter, sigFilter, dateFrom, dateTo, branchFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const captured = rows.filter(r => r.status === 'captured').length;
    const failed = rows.filter(r => r.status === 'failed' || r.status === 'rejected' || (r.http_status && r.http_status >= 400)).length;
    const sigInvalid = rows.filter(r => r.signature_verified === false).length;
    return { total, captured, failed, sigInvalid };
  }, [rows]);

  const handleReconcile = async (row: WebhookRow) => {
    if (!row.invoice_id) {
      toast.error('No invoice linked — cannot reconcile');
      return;
    }
    if (row.signature_verified !== true) {
      toast.error('Refusing to reconcile a webhook with unverified signature');
      return;
    }
    if (!row.amount || row.amount <= 0) {
      toast.error('Invalid amount on this webhook');
      return;
    }
    setReconcilingId(row.id);
    try {
      const { data: inv, error: invErr } = await supabase
        .from('invoices').select('id, member_id, branch_id, status').eq('id', row.invoice_id).maybeSingle();
      if (invErr || !inv) throw new Error(invErr?.message || 'Invoice not found');
      if (inv.status !== 'pending') {
        throw new Error(`Invoice is already ${inv.status}; nothing to reconcile`);
      }
      const { data, error } = await supabase.rpc('record_payment', {
        p_branch_id: inv.branch_id,
        p_invoice_id: inv.id,
        p_member_id: inv.member_id,
        p_amount: row.amount,
        p_payment_method: 'online',
        p_transaction_id: row.gateway_payment_id || undefined,
        p_notes: `Manual reconcile — ${GATEWAY_LABEL[row.gateway] || row.gateway} ${row.gateway_payment_id || row.gateway_order_id || ''}`,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (result?.success === false) throw new Error(result?.error || 'Reconcile RPC returned failure');
      toast.success('Payment reconciled — invoice updated');
      refetch();
      qc.invalidateQueries({ queryKey: ['webhook-activity-invoice-status'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Reconcile failed');
    } finally {
      setReconcilingId(null);
    }
  };

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Webhook className="h-4 w-4" />
              </span>
              Webhook Activity
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Every payment webhook delivery, signature verification, and HTTP outcome.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border/60 p-3 bg-muted/40">
            <p className="text-xs text-muted-foreground">Total (last 100)</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 p-3 bg-emerald-500/5">
            <p className="text-xs text-emerald-700 dark:text-emerald-400">Captured</p>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{stats.captured}</p>
          </div>
          <div className="rounded-xl border border-destructive/20 p-3 bg-destructive/5">
            <p className="text-xs text-destructive">Failed / Rejected</p>
            <p className="text-2xl font-bold text-destructive">{stats.failed}</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 p-3 bg-amber-500/5">
            <p className="text-xs text-amber-700 dark:text-amber-400">Bad signatures</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{stats.sigInvalid}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 rounded-xl" placeholder="Member, invoice, order ID, payment ID, event, error..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
            <SelectTrigger className="w-[140px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All gateways</SelectItem>
              <SelectItem value="razorpay">Razorpay</SelectItem>
              <SelectItem value="phonepe">PhonePe</SelectItem>
              <SelectItem value="payu">PayU</SelectItem>
              <SelectItem value="ccavenue">CCAvenue</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="captured">Captured</SelectItem>
              <SelectItem value="authorized">Pending capture</SelectItem>
              <SelectItem value="created">Created (no webhook)</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="received">Received</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sigFilter} onValueChange={setSigFilter}>
            <SelectTrigger className="w-[150px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All signatures</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="invalid">Invalid</SelectItem>
              <SelectItem value="unchecked">Not checked</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="From date" className="w-[150px] rounded-xl" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" className="w-[150px] rounded-xl" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Received</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action taken</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Linked</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Webhook className="h-8 w-8 opacity-30" />
                      <p className="font-medium text-foreground/70">No webhook deliveries yet</p>
                      <p className="text-xs">Configure a payment gateway and paste the webhook URL to start receiving events.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map(r => {
                const ts = r.received_at || r.updated_at || r.created_at;
                const isOk = r.http_status !== null && r.http_status >= 200 && r.http_status < 300;
                const invStatus = r.invoice_id ? invoiceStatuses[r.invoice_id] : undefined;
                const canReconcile = !!r.invoice_id
                  && r.signature_verified === true
                  && !!r.amount && r.amount > 0
                  && r.status !== 'voided'
                  && invStatus === 'pending';
                return (
                  <Collapsible key={r.id} open={expandedId === r.id} onOpenChange={(o) => setExpandedId(o ? r.id : null)} asChild>
                    <>
                      <TableRow
                        className={`hover:bg-muted/30 ${r.invoice_id || r.invoice?.member_id || r.member_id ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          const memberId = r.invoice?.member_id || r.member_id;
                          if (r.invoice_id) {
                            window.open(`/invoices?invoice=${r.invoice_id}`, '_blank', 'noopener,noreferrer');
                          } else if (memberId) {
                            window.open(`/members?member=${memberId}`, '_blank', 'noopener,noreferrer');
                          }
                        }}
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm">{format(new Date(ts), 'dd MMM HH:mm:ss')}</span>
                            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(ts), { addSuffix: true })}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="rounded-full">{GATEWAY_LABEL[r.gateway] || r.gateway}</Badge>
                          {r.source === 'webhook' && <Badge variant="outline" className="ml-1 text-[10px]">log</Badge>}
                        </TableCell>
                        <TableCell><span className="font-mono text-xs">{r.event_type || '—'}</span></TableCell>
                        <TableCell><SignatureBadge verified={r.signature_verified} /></TableCell>
                        <TableCell>
                          {r.http_status === null ? <span className="text-muted-foreground text-sm">—</span> : (
                            <span className={`font-mono text-sm ${isOk ? 'text-emerald-600' : 'text-destructive'}`}>{r.http_status}</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={r.status} httpStatus={r.http_status} /></TableCell>
                        <TableCell>
                          {(() => {
                            const a = deriveAction(r);
                            const tone = a.tone === 'good' ? 'text-emerald-600'
                              : a.tone === 'bad' ? 'text-destructive'
                              : a.tone === 'warn' ? 'text-amber-600'
                              : 'text-muted-foreground';
                            return <span className={`text-xs ${tone}`}>{a.label}</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const memberName = r.invoice?.members?.profiles?.full_name || r.member?.profiles?.full_name;
                            const memberCode = r.invoice?.members?.member_code || r.member?.member_code;
                            const memberId = r.invoice?.member_id || r.member_id;
                            if (!memberName && !memberCode) {
                              return <span className="text-xs text-muted-foreground">—</span>;
                            }
                            return (
                              <a
                                href={memberId ? `/members?member=${memberId}` : '/members'}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex flex-col text-xs hover:underline"
                                title={memberName || memberCode || ''}
                              >
                                <span className="text-foreground font-medium truncate max-w-[160px]">{memberName || '—'}</span>
                                {memberCode && <span className="text-muted-foreground font-mono">{memberCode}</span>}
                              </a>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          {r.invoice_id ? (
                            <a
                              href={`/invoices?invoice=${r.invoice_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs font-mono text-primary hover:underline"
                              title={r.invoice?.invoice_number || r.invoice_id}
                            >
                              {r.invoice?.invoice_number || `Invoice ${r.invoice_id.slice(0, 8)}…`}
                            </a>
                          ) : r.gateway_order_id ? (
                            <span className="text-xs font-mono text-muted-foreground" title={r.gateway_order_id}>
                              {r.gateway_order_id.length > 14 ? `${r.gateway_order_id.slice(0, 14)}…` : r.gateway_order_id}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">{r.amount ? `₹${r.amount.toLocaleString()}` : '—'}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => e.stopPropagation()}>
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedId === r.id ? 'rotate-180' : ''}`} />
                              </Button>
                            </CollapsibleTrigger>
                            {canReconcile && (
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs gap-1"
                                disabled={reconcilingId === r.id}
                                onClick={(e) => { e.stopPropagation(); handleReconcile(r); }}
                              >
                                <RefreshCw className={`h-3 w-3 ${reconcilingId === r.id ? 'animate-spin' : ''}`} />
                                Reconcile
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={11} className="p-4">
                            <div className="grid gap-3 md:grid-cols-2 text-sm">
                              <div className="space-y-1.5">
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">Member</span>
                                  <span className="break-all">
                                    {(r.invoice?.members?.profiles?.full_name || r.member?.profiles?.full_name) ?? '—'}
                                    {(r.invoice?.members?.member_code || r.member?.member_code) && (
                                      <span className="ml-2 text-muted-foreground font-mono">
                                        {r.invoice?.members?.member_code || r.member?.member_code}
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">Invoice number</span>
                                  <span className="font-mono break-all">{r.invoice?.invoice_number || '—'}</span>
                                </div>
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">Order ID</span>
                                  <span className="font-mono break-all">{r.gateway_order_id || '—'}</span>
                                </div>
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">Payment ID</span>
                                  <span className="font-mono break-all">{r.gateway_payment_id || '—'}</span>
                                </div>
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">Invoice ID</span>
                                  <span className="font-mono break-all">{r.invoice_id || '—'}</span>
                                </div>
                                <div className="grid grid-cols-[140px_1fr] gap-2">
                                  <span className="text-muted-foreground">Source</span>
                                  <span>{r.source || 'order'}</span>
                                </div>
                              </div>
                              <div>
                                {r.error_message && (
                                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 mb-2 flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                    <span className="text-destructive text-xs">{r.error_message}</span>
                                  </div>
                                )}
                                <details className="mb-2">
                                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View raw payload (received)</summary>
                                  <pre className="mt-2 rounded-lg bg-muted/60 p-3 text-[11px] overflow-x-auto max-h-64">{JSON.stringify(r.webhook_data, null, 2)}</pre>
                                </details>
                                <details>
                                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View response sent to gateway</summary>
                                  <pre className="mt-2 rounded-lg bg-muted/60 p-3 text-[11px] overflow-x-auto max-h-64">{r.response_body ? JSON.stringify(r.response_body, null, 2) : '— no response body recorded —'}</pre>
                                </details>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>
            {totalCount === 0
              ? 'No deliveries match the current filters'
              : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount}`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
            <span>Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface LastReceivedRow {
  received_at: string | null;
  http_status: number | null;
  signature_verified: boolean | null;
}

export function GatewayLastReceivedBadge({ gateway, branchId }: { gateway: string; branchId?: string | null }) {
  const { data, isLoading } = useQuery<LastReceivedRow | null>({
    queryKey: ['gateway-last-received', gateway, branchId || 'all'],
    queryFn: async () => {
      let q = supabase
        .from('payment_transactions')
        .select('received_at, http_status, signature_verified')
        .eq('gateway', gateway)
        .eq('source', 'webhook')
        .not('received_at', 'is', null)
        .order('received_at', { ascending: false })
        .limit(1);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data } = await q;
      return ((data && data[0]) as LastReceivedRow | undefined) || null;
    },
    refetchInterval: 30000,
  });
  if (isLoading) return null;
  if (!data?.received_at) {
    return <div className="mt-2 text-xs text-muted-foreground">No deliveries yet</div>;
  }
  const ok = (data.http_status ?? 0) >= 200 && (data.http_status ?? 0) < 300 && data.signature_verified !== false;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className={`mt-2 flex items-center gap-1.5 text-xs ${ok ? 'text-emerald-600' : 'text-destructive'}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>Last webhook {formatDistanceToNow(new Date(data.received_at), { addSuffix: true })}</span>
    </div>
  );
}
