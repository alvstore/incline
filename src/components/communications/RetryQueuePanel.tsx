import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RotateCcw, Ban, AlertCircle, Mail, MessageSquare, Phone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const channelIcon = (t: string) => {
  if (t === 'whatsapp') return <MessageSquare className="h-3.5 w-3.5 text-success" />;
  if (t === 'sms') return <Phone className="h-3.5 w-3.5 text-info" />;
  if (t === 'email') return <Mail className="h-3.5 w-3.5 text-warning" />;
  return <AlertCircle className="h-3.5 w-3.5" />;
};

export function RetryQueuePanel() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['retry-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communication_retry_queue')
        .select('*')
        .in('status', ['pending', 'retrying', 'failed'])
        .order('next_retry_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

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

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('communication_retry_queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Cancelled');
      qc.invalidateQueries({ queryKey: ['retry-queue'] });
    },
  });

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg shadow-destructive/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-destructive/10 dark:bg-destructive/10">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            Failed & Retry Queue
            {rows.length > 0 && (
              <Badge variant="destructive" className="rounded-full ml-1">{rows.length}</Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-success/10 dark:bg-success/10 flex items-center justify-center mb-2">
              <RotateCcw className="h-5 w-5 text-success" />
            </div>
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="text-xs text-muted-foreground">No failed messages awaiting retry</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[360px] pr-2">
            <div className="space-y-2">
              {rows.map((r: any, i: number) => (
                <div
                  key={r.id}
                  style={{ animationDelay: `${i * 30}ms` }}
                  className={cn(
                    'animate-fade-in flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/60 transition-colors border border-transparent hover:border-border/50'
                  )}
                >
                  <div className="p-2 rounded-lg bg-card border border-border/50">{channelIcon(r.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{r.recipient}</span>
                      <Badge variant="outline" className="text-[10px] capitalize rounded-full">
                        {r.retry_count}/{r.max_retries}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-destructive dark:text-destructive truncate mt-0.5">
                      {r.last_error || 'Awaiting retry'}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Next: {r.next_retry_at ? formatDistanceToNow(new Date(r.next_retry_at), { addSuffix: true }) : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="rounded-lg h-8 gap-1" onClick={() => retryNow.mutate(r.id)}>
                      <RotateCcw className="h-3 w-3" />Retry
                    </Button>
                    <Button size="icon" variant="ghost" className="rounded-lg h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => cancel.mutate(r.id)}>
                      <Ban className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
