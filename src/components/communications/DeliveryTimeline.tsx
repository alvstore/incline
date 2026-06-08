import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Clock, Send, Eye, MessageSquareReply, XCircle, AlertTriangle, Info, Hourglass } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
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
  queued:    { icon: Clock,              dotBg: 'bg-warning',   dotRing: 'ring-warning/40',   text: 'text-warning',   label: 'Queued' },
  sent:      { icon: Send,               dotBg: 'bg-info',     dotRing: 'ring-info/40',     text: 'text-info',     label: 'Sent' },
  delivered: { icon: CheckCircle2,       dotBg: 'bg-success', dotRing: 'ring-success/40', text: 'text-success', label: 'Delivered' },
  read:      { icon: Eye,                dotBg: 'bg-primary',  dotRing: 'ring-primary/40',  text: 'text-primary',  label: 'Read' },
  replied:   { icon: MessageSquareReply, dotBg: 'bg-primary',  dotRing: 'ring-primary/40',  text: 'text-primary',  label: 'Replied' },
  failed:    { icon: XCircle,            dotBg: 'bg-destructive',    dotRing: 'ring-destructive/40',    text: 'text-destructive',    label: 'Failed' },
  bounced:   { icon: AlertTriangle,      dotBg: 'bg-destructive',    dotRing: 'ring-destructive/40',    text: 'text-destructive',    label: 'Bounced' },
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

function resolveLogStage(
  logStatus?: string | null,
  logDeliveryStatus?: string | null,
): Stage | 'pending' {
  const s = (logStatus || '').toLowerCase();
  const d = (logDeliveryStatus || '').toLowerCase();
  if (s === 'failed' || s === 'bounced') return s as Stage;
  if (d === 'failed' || d === 'bounced') return d as Stage;
  if (d === 'replied' || d === 'read' || d === 'delivered') return d as Stage;
  if (s === 'sent') return 'sent';
  if (d && (stageOrder as readonly string[]).includes(d) && d !== 'queued') return d as Stage;
  return 'pending';
}

function synthesizeFromLog(
  logStatus?: string | null,
  logDeliveryStatus?: string | null,
  logSentAt?: string | null,
  logCreatedAt?: string | null,
  logErrorMessage?: string | null,
): Event[] {
  if (!logCreatedAt) return [];
  const stage = resolveLogStage(logStatus, logDeliveryStatus);
  const out: Event[] = [
    { id: 'syn-queued', new_status: 'queued', previous_status: null, provider: null, error_message: null, created_at: logCreatedAt },
  ];
  if (stage === 'pending') return out;
  const sentTs = logSentAt || logCreatedAt;
  if (stage === 'failed' || stage === 'bounced') {
    out.push({ id: `syn-${stage}`, new_status: stage, previous_status: 'queued', provider: null, error_message: logErrorMessage || null, created_at: sentTs });
    return out;
  }
  out.push({ id: 'syn-sent', new_status: 'sent', previous_status: 'queued', provider: null, error_message: null, created_at: sentTs });
  if (stage === 'sent') return out;
  const idx = stageOrder.indexOf(stage as any);
  for (let i = 2; i <= idx; i++) {
    const s = stageOrder[i];
    out.push({ id: `syn-${s}`, new_status: s, previous_status: stageOrder[i - 1], provider: null, error_message: null, created_at: sentTs });
  }
  return out;
}

interface DeliveryTimelineProps {
  logId: string;
  createdAt?: string;
  logStatus?: string | null;
  logDeliveryStatus?: string | null;
  logSentAt?: string | null;
  logErrorMessage?: string | null;
  /** lowercased channel ('sms' | 'email' | 'whatsapp' | 'rcs' | 'in_app'); used to render N/A pills for stages a provider can't report. */
  channel?: string;
}

export function DeliveryTimeline({
  logId,
  createdAt,
  logStatus,
  logDeliveryStatus,
  logSentAt,
  logErrorMessage,
  channel,
}: DeliveryTimelineProps) {
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
    return (
      <div className="mx-4 my-3 rounded-2xl border border-border/40 bg-gradient-to-br from-muted/40 via-card to-muted/20 px-5 py-4 shadow-sm">
        <div className="relative w-full px-2">
          <div className="absolute left-5 right-5 top-4 h-1 rounded-full bg-border/60 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]" />
          </div>
          <div className="relative flex items-start justify-between">
            {stageOrder.map((s) => (
              <div key={s} className="flex flex-col items-center min-w-0 flex-1">
                <div className="relative z-10 h-9 w-9 rounded-full bg-muted/60 ring-4 ring-background animate-pulse" />
                <div className="mt-2 h-2.5 w-12 rounded-full bg-muted/60 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // If we have no real delivery events, derive a synthetic chain from the parent
  // log so already-sent/delivered messages don't get stuck on the amber card.
  const effectiveEvents: Event[] =
    events.length > 0
      ? events
      : synthesizeFromLog(logStatus, logDeliveryStatus, logSentAt, createdAt, logErrorMessage);

  const resolvedStage = resolveLogStage(logStatus, logDeliveryStatus);
  const isPendingOnly =
    events.length === 0 && (effectiveEvents.length === 0 || resolvedStage === 'pending');

  if (isPendingOnly) {
    const isQueued =
      (logDeliveryStatus || '').toLowerCase() === 'queued' ||
      (logStatus || '').toLowerCase() === 'queued';
    return (
      <div className="mx-4 my-3 rounded-2xl border border-warning/25 dark:border-warning/20 bg-gradient-to-br from-warning/10 via-card to-warning/10 dark:from-warning/5 dark:via-card dark:to-warning/5 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative h-9 w-9 rounded-full bg-warning/15 text-warning flex items-center justify-center ring-4 ring-background">
            <Hourglass className="h-4 w-4" />
            <span className="absolute inset-0 rounded-full bg-warning/15 animate-ping opacity-50" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {isQueued ? 'Queued for delivery' : 'Waiting for provider acknowledgement'}
            </div>
            <div className="text-xs text-muted-foreground">
              {createdAt
                ? `${isQueued ? 'Queued' : 'Created'} ${formatDistanceToNow(new Date(createdAt), { addSuffix: true })} · no status reported yet`
                : "Provider hasn't reported a status yet"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const reachedStages = new Set(effectiveEvents.map((e) => e.new_status));
  const failureEvent = effectiveEvents.find((e) => e.new_status === 'failed' || e.new_status === 'bounced');
  const hasFailure = !!failureEvent;

  // Channel capability: SMS has no "read" / "replied" receipt — drop those
  // stages so the rail doesn't sit forever pending for SMS rows.
  const channelStageOrder: readonly Stage[] = (channel === 'sms')
    ? (stageOrder.filter((s) => s !== 'read' && s !== 'replied') as Stage[])
    : (stageOrder as readonly Stage[]);

  // Visible stage list:
  //  • happy path → channel-appropriate stages
  //  • failure   → reached stages + failed pill at the end
  const visibleStages: Stage[] = hasFailure
    ? ([...channelStageOrder.filter((s) => reachedStages.has(s)), failureEvent!.new_status as Stage])
    : ([...channelStageOrder] as Stage[]);

  // Latest reached stage = drives the "active" pulse
  const lastEvent = effectiveEvents[effectiveEvents.length - 1];
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
          ? 'bg-gradient-to-br from-destructive/10 via-card to-destructive/10 dark:from-destructive/10 dark:via-card dark:to-destructive/5 border-destructive/25 dark:border-destructive/20 shadow-sm shadow-destructive/20'
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
              ? 'bg-gradient-to-r from-info via-success to-destructive'
              : 'bg-gradient-to-r from-info via-success to-primary',
          )}
          style={{ width: `calc((100% - 2.5rem) * ${fillPct / 100})` }}
        />

        <div className="relative flex items-start justify-between">
          {visibleStages.map((stage) => {
            const meta = stageMeta[stage];
            const reached = reachedStages.has(stage);
            const event = effectiveEvents.find((e) => e.new_status === stage);
            const Icon = meta.icon;
            const isActive = stage === activeStage;
            const isFailureStage = stage === 'failed' || stage === 'bounced';
            return (
              <div key={stage} className="flex flex-col items-center min-w-0 flex-1" aria-label={meta.label}>
                <div
                  className={cn(
                    'relative z-10 h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ring-4 ring-background',
                    reached
                      ? `${meta.dotBg} text-primary-foreground shadow-lg shadow-black/10`
                      : 'bg-background text-muted-foreground/40 border-2 border-dashed border-border',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.5} />
                  {reached && isActive && !isFailureStage && (
                    <span className={cn('absolute inset-0 rounded-full opacity-60 animate-ping', meta.dotBg)} />
                  )}
                  {isFailureStage && (
                    <span className="absolute inset-0 rounded-full opacity-50 animate-ping bg-destructive" />
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
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/15 dark:bg-destructive/10 border border-destructive/25 dark:border-destructive/20 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-destructive dark:text-destructive leading-snug">
              {errorInfo.code ? `Meta error ${errorInfo.code}: ` : ''}{errorInfo.title}
            </div>
            {errorInfo.hint && (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-destructive/80 dark:text-destructive/80 leading-snug">
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
