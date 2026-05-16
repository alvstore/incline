import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Clock, Send, Eye, MessageSquareReply, XCircle, AlertTriangle, Info } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Event {
  id: string;
  new_status: string;
  previous_status: string | null;
  provider: string | null;
  error_message: string | null;
  created_at: string;
}

const stageOrder = ['queued', 'sent', 'delivered', 'read', 'replied'] as const;
type Stage = (typeof stageOrder)[number] | 'failed' | 'bounced';

const stageMeta: Record<Stage, { icon: any; dotBg: string; dotRing: string; text: string; label: string }> = {
  queued:    { icon: Clock,              dotBg: 'bg-amber-500',   dotRing: 'ring-amber-300/60',   text: 'text-amber-600',   label: 'Queued' },
  sent:      { icon: Send,               dotBg: 'bg-sky-500',     dotRing: 'ring-sky-300/60',     text: 'text-sky-600',     label: 'Sent' },
  delivered: { icon: CheckCircle2,       dotBg: 'bg-emerald-500', dotRing: 'ring-emerald-300/60', text: 'text-emerald-600', label: 'Delivered' },
  read:      { icon: Eye,                dotBg: 'bg-violet-500',  dotRing: 'ring-violet-300/60',  text: 'text-violet-600',  label: 'Read' },
  replied:   { icon: MessageSquareReply, dotBg: 'bg-indigo-500',  dotRing: 'ring-indigo-300/60',  text: 'text-indigo-600',  label: 'Replied' },
  failed:    { icon: XCircle,            dotBg: 'bg-rose-500',    dotRing: 'ring-rose-300/60',    text: 'text-rose-600',    label: 'Failed' },
  bounced:   { icon: AlertTriangle,      dotBg: 'bg-rose-500',    dotRing: 'ring-rose-300/60',    text: 'text-rose-600',    label: 'Bounced' },
};

// Friendly explanations for the most common Meta WhatsApp error codes so
// staff don't have to look them up. Format we expect: "131047: Re-engagement message".
const META_ERROR_HINTS: Record<string, string> = {
  '131047': 'Outside the 24h customer-service window — Meta requires an approved template message. Submit one in Settings → Communication Templates.',
  '131026': 'Recipient has not opted in to receive WhatsApp messages.',
  '131051': 'Unsupported message type for this conversation.',
  '132001': 'Template name does not exist or is not approved in this language.',
  '132012': 'Template parameter format mismatch — variable count or order is wrong.',
  '470':    'Conversation window expired — re-open with an approved template.',
};

function explainError(raw: string | null | undefined): { code?: string; title: string; hint?: string } {
  if (!raw) return { title: 'Delivery failed' };
  const m = raw.match(/^\s*(\d{2,5})\s*[:-]\s*(.+)$/);
  if (m) {
    const code = m[1];
    return { code, title: m[2].trim(), hint: META_ERROR_HINTS[code] };
  }
  return { title: raw };
}

export function DeliveryTimeline({ logId }: { logId: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from('communication_delivery_events')
        .select('id,new_status,previous_status,provider,error_message,created_at')
        .eq('communication_log_id', logId)
        .order('created_at', { ascending: true });
      if (active) {
        setEvents((data as any) || []);
        setLoading(false);
      }
    };
    load();
    const ch = supabase
      .channel(`delivery-events-${logId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communication_delivery_events', filter: `communication_log_id=eq.${logId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [logId]);

  if (loading) {
    return <div className="py-3 text-xs text-muted-foreground text-center">Loading timeline…</div>;
  }

  const reachedStages = new Set(events.map((e) => e.new_status));
  const failureEvent = events.find((e) => e.new_status === 'failed' || e.new_status === 'bounced');
  const hasFailure = !!failureEvent;

  // Visible stage list:
  //  • happy path → all 5 stages
  //  • failure   → reached stages + failed pill at the end
  const visibleStages: Stage[] = hasFailure
    ? ([...stageOrder.filter((s) => reachedStages.has(s)), failureEvent!.new_status as Stage])
    : ([...stageOrder] as Stage[]);

  // Latest reached stage = drives the "active" pulse
  const lastEvent = events[events.length - 1];
  const activeStage = lastEvent?.new_status as Stage | undefined;

  // Compute progress fill width as a % across the visible track
  const lastReachedIdx = Math.max(
    0,
    ...visibleStages.map((s, i) => (reachedStages.has(s) ? i : -1)),
  );
  const fillPct = visibleStages.length > 1
    ? (lastReachedIdx / (visibleStages.length - 1)) * 100
    : 0;

  const errorInfo = hasFailure ? explainError(failureEvent?.error_message) : null;

  return (
    <div
      className={cn(
        'mx-4 my-3 rounded-2xl border px-5 py-4 transition-colors',
        hasFailure
          ? 'bg-gradient-to-br from-rose-50/80 via-card to-rose-50/40 dark:from-rose-500/10 dark:via-card dark:to-rose-500/5 border-rose-200/70 dark:border-rose-500/20 shadow-sm shadow-rose-500/10'
          : 'bg-gradient-to-br from-muted/40 via-card to-muted/20 border-border/40 shadow-sm',
      )}
    >
      <div className="relative w-full px-2">
        {/* Track (background capsule) */}
        <div className="absolute left-5 right-5 top-4 h-1 bg-border/60 rounded-full" />
        {/* Track (animated gradient fill) */}
        <div
          className={cn(
            'absolute left-5 top-4 h-1 rounded-full transition-all duration-700 ease-out',
            hasFailure
              ? 'bg-gradient-to-r from-sky-500 via-emerald-500 to-rose-500'
              : 'bg-gradient-to-r from-sky-500 via-emerald-500 to-violet-500',
          )}
          style={{ width: `calc((100% - 2.5rem) * ${fillPct / 100})` }}
        />

        <div className="relative flex items-start justify-between">
          {visibleStages.map((stage) => {
            const meta = stageMeta[stage];
            const reached = reachedStages.has(stage);
            const event = events.find((e) => e.new_status === stage);
            const Icon = meta.icon;
            const isActive = stage === activeStage;
            const isFailureStage = stage === 'failed' || stage === 'bounced';
            return (
              <div key={stage} className="flex flex-col items-center min-w-0 flex-1" aria-label={meta.label}>
                <div
                  className={cn(
                    'relative z-10 h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ring-4 ring-background',
                    reached
                      ? `${meta.dotBg} text-white shadow-lg shadow-black/10`
                      : 'bg-background text-muted-foreground/40 border-2 border-dashed border-border',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.5} />
                  {reached && isActive && !isFailureStage && (
                    <span className={cn('absolute inset-0 rounded-full opacity-60 animate-ping', meta.dotBg)} />
                  )}
                  {isFailureStage && (
                    <span className="absolute inset-0 rounded-full opacity-50 animate-ping bg-rose-500" />
                  )}
                </div>
                <div className="mt-2 text-center leading-tight">
                  <div className={cn(
                    'text-[10px] font-bold tracking-wide uppercase',
                    reached ? meta.text : 'text-muted-foreground/50',
                  )}>
                    {meta.label}
                  </div>
                  {event && (
                    <div className="text-[10px] text-muted-foreground/70 tabular-nums mt-0.5 font-medium">
                      {format(new Date(event.created_at), 'HH:mm:ss')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hasFailure && errorInfo && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-100/70 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-rose-700 dark:text-rose-300 leading-snug">
              {errorInfo.code ? `Meta error ${errorInfo.code}: ` : ''}{errorInfo.title}
            </div>
            {errorInfo.hint && (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-rose-700/80 dark:text-rose-300/80 leading-snug">
                <Info className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{errorInfo.hint}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
