import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { BookOpenCheck, Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface SyncResponse {
  success: boolean;
  error?: string;
  organization?: string;
  remaining?: number;
  invoices_synced?: number;
  invoices_failed?: number;
  payments_synced?: number;
  payments_failed?: number;
  errors?: string[];
}

export function ZohoBooksSyncCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lastRun, setLastRun] = useState<SyncResponse | null>(null);

  const statsQuery = useQuery({
    queryKey: ['zoho-sync-stats'],
    queryFn: async () => {
      const [{ count: gstTotal }, { data: log }] = await Promise.all([
        supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('is_gst_invoice', true)
          .eq('is_proforma', false)
          .gt('gst_rate', 0)
          .gt('tax_amount', 0)
          .not('status', 'in', '(cancelled,draft,refunded)')
          .not('invoice_number', 'ilike', 'BOS%'),
        supabase.from('zoho_sync_log').select('entity_type, status, error, synced_at'),
      ]);
      const rows = log ?? [];
      const invSynced = rows.filter((r) => r.entity_type === 'invoice' && r.status === 'synced').length;
      const invFailed = rows.filter((r) => r.entity_type === 'invoice' && r.status === 'failed').length;
      const paySynced = rows.filter((r) => r.entity_type === 'payment' && r.status === 'synced').length;
      const lastError = rows.filter((r) => r.status === 'failed').map((r) => r.error).filter(Boolean)[0] ?? null;
      return {
        gstTotal: gstTotal ?? 0,
        invSynced,
        invFailed,
        paySynced,
        pending: Math.max((gstTotal ?? 0) - invSynced, 0),
        lastError,
      };
    },
    staleTime: 15_000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('zoho-books-sync', {
        body: { limit: 25 },
      });
      if (error) throw new Error(error.message);
      const result = data as SyncResponse;
      if (!result?.success) throw new Error(result?.error || 'Sync failed');
      return result;
    },
    onSuccess: (result) => {
      setLastRun(result);
      queryClient.invalidateQueries({ queryKey: ['zoho-sync-stats'] });
      toast({
        title: 'Zoho Books sync complete',
        description: `${result.invoices_synced ?? 0} invoices and ${result.payments_synced ?? 0} payments pushed. ${result.remaining ?? 0} remaining.`,
      });
    },
    onError: (e: Error) => {
      toast({ title: 'Zoho Books sync failed', description: e.message, variant: 'destructive' });
    },
  });

  const stats = statsQuery.data;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-indigo-50 p-2 text-indigo-600" aria-hidden="true">
            <BookOpenCheck className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="text-base font-bold text-slate-900">Zoho Books sync</CardTitle>
            <CardDescription className="text-sm text-slate-500">
              Pushes GST invoices and their recorded payments to Zoho Books. Non-GST and cancelled invoices are skipped.
            </CardDescription>
          </div>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="cursor-pointer gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncMutation.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {statsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : statsQuery.isError ? (
          <p className="text-sm text-red-600">Couldn’t load sync status.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'GST invoices', value: stats?.gstTotal ?? 0 },
              { label: 'Synced', value: stats?.invSynced ?? 0 },
              { label: 'Pending', value: stats?.pending ?? 0 },
              { label: 'Payments synced', value: stats?.paySynced ?? 0 },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{s.label}</p>
                <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {stats && stats.invFailed > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {stats.invFailed} invoice{stats.invFailed > 1 ? 's' : ''} failed to sync.
              {stats.lastError ? ` Last error: ${stats.lastError}` : ''}
            </span>
          </div>
        )}

        {lastRun && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Last run:</span>
            <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              {lastRun.invoices_synced ?? 0} invoices
            </Badge>
            <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              {lastRun.payments_synced ?? 0} payments
            </Badge>
            {(lastRun.remaining ?? 0) > 0 && (
              <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                {lastRun.remaining} remaining — run again
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
