import { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RotateCcw, Ban, AlertCircle, Mail, MessageSquare, Phone, Play, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'pending' | 'retrying' | 'failed' | 'exhausted';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'retrying', label: 'Retrying' },
  { key: 'failed', label: 'Failed' },
  { key: 'exhausted', label: 'Exhausted' },
];

const channelIcon = (t: string) => {
  if (t === 'whatsapp') return <MessageSquare className="h-3.5 w-3.5 text-success" />;
  if (t === 'sms') return <Phone className="h-3.5 w-3.5 text-info" />;
  if (t === 'email') return <Mail className="h-3.5 w-3.5 text-warning" />;
  return <AlertCircle className="h-3.5 w-3.5" />;
};

export function RetryQueuePanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['retry-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communication_retry_queue')
        .select('*')
        .in('status', ['pending', 'retrying', 'failed', 'exhausted'])
        .order('next_retry_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r: any) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, pending: 0, retrying: 0, failed: 0, exhausted: 0 };
    rows.forEach((r: any) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  useEffect(() => {
    const ch = supabase
      .channel('retry-queue-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'communication_retry_queue' },
        () => qc.invalidateQueries({ queryKey: ['retry-queue'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const retryNow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('communication_retry_queue')
        .update({ next_retry_at: new Date().toISOString(), status: 'pending' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Retry scheduled');
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const restart = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('communication_retry_queue')
        .update({ status: 'pending', retry_count: 0, next_retry_at: new Date().toISOString(), last_error: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Restarted');
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('communication_retry_queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Stopped');
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
  });

  const stopAll = useMutation({
    mutationFn: async () => {
      // Bulk-cancel EVERY live row in DB (not just the visible 100).
      const { data, error } = await supabase
        .from('communication_retry_queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .in('status', ['pending', 'retrying', 'failed'])
        .select('id');
      if (error) throw error;
      return (data ?? []).length;
    },
    onSuccess: (n) => {
      if (n === 0) toast.info('Nothing live to stop');
      else toast.success(`Stopped ${n} message${n === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const clearExhausted = useMutation({
    mutationFn: async () => {
      // Bulk-delete every dead row in DB (exhausted + already-cancelled).
      const { data, error } = await supabase
        .from('communication_retry_queue')
        .delete()
        .in('status', ['exhausted', 'cancelled'])
        .select('id');
      if (error) throw error;
      return (data ?? []).length;
    },

    onSuccess: (n) => {
      if (n === 0) toast.info('Nothing to clear');
      else toast.success(`Cleared ${n} exhausted message${n === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const clearOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('communication_retry_queue').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Removed');
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const retryAll = useMutation({
    mutationFn: async () => {
      const ids = visible
        .filter((r: any) => r.status === 'failed' || r.status === 'pending' || r.status === 'retrying')
        .map((r: any) => r.id);
      if (!ids.length) return 0;
      const { error } = await supabase
        .from('communication_retry_queue')
        .update({ next_retry_at: new Date().toISOString(), status: 'pending' })
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`Retrying ${n} message${n === 1 ? '' : 's'} now`);
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
  });

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg shadow-destructive/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-destructive/10">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            Failed &amp; Retry Queue
            {rows.length > 0 && (
              <Badge variant="destructive" className="rounded-full ml-1">{rows.length}</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm" variant="outline" className="h-8 rounded-lg gap-1.5"
              onClick={() => retryAll.mutate()}
              disabled={retryAll.isPending || visible.length === 0}
            >
              <RotateCcw className="h-3.5 w-3.5" />Retry all
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm" variant="outline"
                  className="h-8 rounded-lg gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  disabled={(counts.pending + counts.retrying + counts.failed) === 0}
                >
                  <Ban className="h-3.5 w-3.5" />Stop all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop every queued retry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cancels every live message in the entire queue (pending, retrying, failed) — not just the 100 shown here.
                    Already-exhausted rows are untouched; use "Clear exhausted" to remove those.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction onClick={() => stopAll.mutate()} className="bg-destructive text-destructive-foreground">
                    Stop all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm" variant="outline"
                  className="h-8 rounded-lg gap-1.5"
                  disabled={counts.exhausted === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />Clear exhausted
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear every exhausted message?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently removes every exhausted row from the queue (not just the 100 shown here).
                    They've already failed their max attempts and won't be retried automatically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearExhausted.mutate()} className="bg-destructive text-destructive-foreground">
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

          </div>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {f.label} <span className="opacity-70">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center mb-2">
              <RotateCcw className="h-5 w-5 text-success" />
            </div>
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="text-xs text-muted-foreground">No messages in this view</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[420px] pr-2">
            <div className="space-y-2">
              {visible.map((r: any, i: number) => {
                const isExhausted = r.status === 'exhausted';
                return (
                  <div
                    key={r.id}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className={cn(
                      'animate-fade-in flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/60 transition-colors border border-transparent hover:border-border/50'
                    )}
                  >
                    <div className="p-2 rounded-lg bg-card border border-border/50">{channelIcon(r.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{r.recipient}</span>
                        <Badge variant="outline" className="text-[10px] capitalize rounded-full">
                          {r.retry_count}/{r.max_retries}
                        </Badge>
                        {isExhausted && (
                          <Badge className="text-[10px] rounded-full bg-slate-200 text-slate-700">Exhausted</Badge>
                        )}
                        {r.status === 'retrying' && (
                          <Badge className="text-[10px] rounded-full bg-amber-100 text-amber-700">Retrying</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-destructive truncate mt-0.5">
                        {r.last_error || 'Awaiting retry'}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {isExhausted
                          ? `Stopped ${r.updated_at ? formatDistanceToNow(new Date(r.updated_at), { addSuffix: true }) : ''}`
                          : `Next: ${r.next_retry_at ? formatDistanceToNow(new Date(r.next_retry_at), { addSuffix: true }) : '—'}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isExhausted ? (
                        <>
                          <Button
                            size="sm" variant="outline"
                            className="rounded-lg h-8 gap-1"
                            onClick={() => restart.mutate(r.id)}
                            aria-label="Restart"
                          >
                            <Play className="h-3 w-3" />Restart
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="rounded-lg h-8 gap-1 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => clearOne.mutate(r.id)}
                            aria-label="Clear"
                          >
                            <Trash2 className="h-3 w-3" />Clear
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="rounded-lg h-8 gap-1" onClick={() => retryNow.mutate(r.id)}>
                            <RotateCcw className="h-3 w-3" />Retry
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="rounded-lg h-8 gap-1 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => cancel.mutate(r.id)}
                            aria-label="Stop"
                          >
                            <Ban className="h-3 w-3" />Stop
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
