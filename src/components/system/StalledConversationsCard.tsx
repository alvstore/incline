import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquareWarning, RefreshCw, UserCog, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface StalledRow {
  inbound_id: string;
  phone_number: string;
  contact_name: string | null;
  content: string | null;
  created_at: string;
  branch_id: string;
  platform: string;
}

/**
 * Surfaces WhatsApp / IG inbounds in the last 24h that received no outbound
 * reply within 5 min. Power-tools: "Retry AI" (kicks monitor-ai-lead-loss for
 * that thread) and "Take Over" (turns the bot off so a human can step in).
 */
export function StalledConversationsCard() {
  const queryClient = useQueryClient();

  const { data: stalled = [], isLoading } = useQuery({
    queryKey: ['stalled-ai-conversations'],
    queryFn: async (): Promise<StalledRow[]> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const slaCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: inbounds, error } = await (supabase.from('whatsapp_messages') as any)
        .select('id, phone_number, contact_name, content, created_at, branch_id, platform')
        .eq('direction', 'inbound')
        .gte('created_at', since)
        .lte('created_at', slaCutoff)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const byPhone = new Map<string, StalledRow>();
      for (const row of (inbounds || []) as any[]) {
        if (!byPhone.has(row.phone_number)) {
          byPhone.set(row.phone_number, {
            inbound_id: row.id,
            phone_number: row.phone_number,
            contact_name: row.contact_name,
            content: row.content,
            created_at: row.created_at,
            branch_id: row.branch_id,
            platform: row.platform || 'whatsapp',
          });
        }
      }
      if (byPhone.size === 0) return [];

      const out: StalledRow[] = [];
      for (const row of byPhone.values()) {
        const { data: laterOut } = await (supabase.from('whatsapp_messages') as any)
          .select('id')
          .eq('phone_number', row.phone_number)
          .eq('direction', 'outbound')
          .gte('created_at', row.created_at)
          .limit(1);
        if (laterOut && laterOut.length > 0) continue;

        const { data: settings } = await (supabase.from('whatsapp_chat_settings') as any)
          .select('bot_active, do_not_contact, handoff_reason')
          .eq('phone_number', row.phone_number)
          .maybeSingle();
        if (settings && (settings.bot_active === false || settings.do_not_contact === true || settings.handoff_reason)) continue;

        out.push(row);
      }
      return out;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('monitor-ai-lead-loss', { body: {} });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Recovery cycle triggered');
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['stalled-ai-conversations'] }), 3000);
    },
    onError: (e: any) => toast.error(`Recovery failed: ${e?.message || 'unknown'}`),
  });

  const takeOverMutation = useMutation({
    mutationFn: async (row: StalledRow) => {
      const { error } = await (supabase.from('whatsapp_chat_settings') as any)
        .upsert(
          {
            branch_id: row.branch_id,
            phone_number: row.phone_number,
            bot_active: false,
            paused_at: new Date().toISOString(),
            handoff_reason: 'manual_takeover',
          },
          { onConflict: 'branch_id,phone_number' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Bot paused — thread handed to staff');
      queryClient.invalidateQueries({ queryKey: ['stalled-ai-conversations'] });
    },
    onError: (e: any) => toast.error(`Take-over failed: ${e?.message || 'unknown'}`),
  });

  const count = stalled.length;

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg">
          <span className="flex items-center gap-2">
            <MessageSquareWarning className={`h-5 w-5 ${count > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
            Stalled AI Conversations
            {count > 0 && <Badge variant="destructive" className="text-xs">{count}</Badge>}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5"
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending || count === 0}
            aria-label="Retry AI for all stalled threads"
          >
            <RefreshCw className={`h-4 w-4 ${retryMutation.isPending ? 'animate-spin' : ''}`} />
            Retry All
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Scanning recent inbounds…</p>
        ) : count === 0 ? (
          <div className="text-center py-6">
            <CheckCircle className="h-10 w-10 text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No leads waiting on a reply. AI is responding within the 5 min SLA.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {stalled.map((row) => (
              <div
                key={row.inbound_id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {row.contact_name || row.phone_number}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">{row.platform}</Badge>
                    <Badge variant="secondary" className="text-xs">
                      {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{row.phone_number}</p>
                  {row.content && (
                    <p className="text-xs text-foreground/70 mt-1 truncate">“{row.content}”</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg gap-1.5"
                    onClick={() => takeOverMutation.mutate(row)}
                    disabled={takeOverMutation.isPending}
                    aria-label={`Take over conversation with ${row.contact_name || row.phone_number}`}
                  >
                    <UserCog className="h-4 w-4" /> Take Over
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          A thread is "stalled" when an inbound has had no outbound reply for more than 5 minutes
          and the bot is still active. The monitor cron auto-recovers every 5 min; use Retry All to force it now.
        </p>
      </CardContent>
    </Card>
  );
}
