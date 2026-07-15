import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Loader2, CheckCircle2, AlertTriangle, Clock, Users, Eye, Send,
  RefreshCw, Repeat, RotateCcw, Search, MessageSquare, Mail, Phone, XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  type Campaign,
  retryFailedRecipients,
  reconcileCampaignStats,
  sendCampaignNow,
  resolveCampaignAudience,
} from '@/services/campaignService';
import { parseCommError } from '@/lib/comms/metaErrorLabels';
import { formatPhoneDisplay } from '@/lib/contacts/phone';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

type MergedRecipient = {
  id: string;
  source_type: string;
  source_ref_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  recipientStatus: string;
  recipientError: string | null;
  attempt: number;
  dlrStatus: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  timestamp: string | null;
  errorLabel: string | null;
  errorRaw: string | null;
  final: 'delivered' | 'read' | 'sent' | 'failed' | 'pending' | 'skipped';
};

const finalOf = (r: {
  recipientStatus: string;
  dlrStatus: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}): MergedRecipient['final'] => {
  const rs = (r.recipientStatus || '').toLowerCase();
  const ds = (r.dlrStatus || '').toLowerCase();
  if (r.readAt || ds === 'read') return 'read';
  if (r.deliveredAt || ds === 'delivered') return 'delivered';
  if (ds === 'failed' || ds === 'bounced' || rs === 'failed') return 'failed';
  if (rs === 'skipped') return 'skipped';
  if (rs === 'sent' || ds === 'sent' || ds === 'queued') return 'sent';
  return 'pending';
};

const statusBadgeClass = (s: MergedRecipient['final']) => {
  switch (s) {
    case 'read':
      return 'bg-primary/15 text-primary';
    case 'delivered':
      return 'bg-success/15 text-success';
    case 'sent':
      return 'bg-info/15 text-info';
    case 'failed':
      return 'bg-destructive/15 text-destructive';
    case 'skipped':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-warning/15 text-warning';
  }
};

const StatusIcon = ({ s }: { s: MergedRecipient['final'] }) => {
  const cls = 'h-3 w-3';
  if (s === 'read') return <Eye className={cls} />;
  if (s === 'delivered') return <CheckCircle2 className={cls} />;
  if (s === 'sent') return <Send className={cls} />;
  if (s === 'failed') return <XCircle className={cls} />;
  if (s === 'skipped') return <AlertTriangle className={cls} />;
  return <Clock className={cls} />;
};

const channelIcon = (channel: string) => {
  if (channel === 'email') return Mail;
  if (channel === 'sms') return Phone;
  return MessageSquare;
};

export function CampaignDetailDrawer({ open, onOpenChange, campaign }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'delivered' | 'failed' | 'pending'>('all');
  const [search, setSearch] = useState('');
  const [confirmRetrigger, setConfirmRetrigger] = useState(false);

  const enabled = !!campaign?.id && open;

  const { data: recipients = [], isLoading: recLoading } = useQuery({
    queryKey: ['campaign-recipients', campaign?.id],
    enabled,
    refetchInterval: campaign?.status === 'sending' ? 3000 : false,
    queryFn: async () => {
      const { data } = await supabase
        .from('campaign_recipients')
        .select('id, source_type, source_ref_id, full_name, phone, email, status, error, attempt, dispatched_at, created_at, fallback_used, fallback_channel, pacing_code')
        .eq('campaign_id', campaign!.id)
        .order('created_at', { ascending: false })
        .limit(2000);
      return data || [];
    },
  });


  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['campaign-logs', campaign?.id],
    enabled,
    refetchInterval: campaign?.status === 'sending' ? 5000 : false,
    queryFn: async () => {
      const { data } = await supabase
        .from('communication_logs')
        .select('dedupe_key, delivery_status, status, error_code, error_message, delivered_at, read_at, created_at')
        .like('dedupe_key', `campaign:${campaign!.id}:%`)
        .order('created_at', { ascending: false })
        .limit(5000);
      return data || [];
    },
  });

  const merged: MergedRecipient[] = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const l of logs as any[]) {
      // strip any :retry:N suffix and take the freshest log per base key
      const base = String(l.dedupe_key || '').replace(/:retry:\d+$/, '');
      const existing = byKey.get(base);
      if (!existing || new Date(l.created_at) > new Date(existing.created_at)) {
        byKey.set(base, l);
      }
    }
    return (recipients as any[]).map((r) => {
      const key = `campaign:${campaign!.id}:${r.source_type}:${r.source_ref_id}`;
      const dlr = byKey.get(key);
      const errRaw = r.error || dlr?.error_message || dlr?.error_code || null;
      const label = errRaw ? parseCommError(errRaw)?.short || errRaw : null;
      const base = {
        id: r.id,
        source_type: r.source_type,
        source_ref_id: r.source_ref_id,
        full_name: r.full_name,
        phone: r.phone,
        email: r.email,
        recipientStatus: r.status,
        recipientError: r.error,
        attempt: r.attempt || 1,
        dlrStatus: dlr?.delivery_status || dlr?.status || null,
        deliveredAt: dlr?.delivered_at || null,
        readAt: dlr?.read_at || null,
        timestamp: r.dispatched_at || dlr?.delivered_at || dlr?.read_at || r.created_at,
        errorLabel: label,
        errorRaw: errRaw,
      };
      return { ...base, final: finalOf(base) };
    });
  }, [recipients, logs, campaign?.id]);

  const counts = useMemo(() => {
    const c = { total: merged.length, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, skipped: 0 };
    for (const m of merged) {
      if (m.final === 'read') { c.read++; c.delivered++; c.sent++; }
      else if (m.final === 'delivered') { c.delivered++; c.sent++; }
      else if (m.final === 'sent') { c.sent++; }
      else if (m.final === 'failed') { c.failed++; }
      else if (m.final === 'skipped') { c.skipped++; }
      else { c.pending++; }
    }
    return c;
  }, [merged]);

  const filtered = useMemo(() => {
    return merged.filter((m) => {
      if (filter === 'delivered' && !['delivered', 'read'].includes(m.final)) return false;
      if (filter === 'failed' && m.final !== 'failed') return false;
      if (filter === 'pending' && !['pending', 'sent'].includes(m.final)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${m.full_name || ''} ${m.phone || ''} ${m.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [merged, filter, search]);

  const retryMut = useMutation({
    mutationFn: () => retryFailedRecipients(campaign!.id),
    onSuccess: (r) => {
      toast.success(`Retrying ${r.accepted} failed recipient${r.accepted === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-recipients', campaign?.id] });
      qc.invalidateQueries({ queryKey: ['campaign-logs', campaign?.id] });
    },
    onError: (e: any) => toast.error(e?.message || 'Retry failed'),
  });

  const reconcileMut = useMutation({
    mutationFn: () => reconcileCampaignStats(campaign!.id),
    onSuccess: () => {
      toast.success('Stats refreshed');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-recipients', campaign?.id] });
      qc.invalidateQueries({ queryKey: ['campaign-logs', campaign?.id] });
    },
    onError: (e: any) => toast.error(e?.message || 'Reconcile failed'),
  });

  const retriggerMut = useMutation({
    mutationFn: async () => {
      if (!campaign) throw new Error('no campaign');
      // Re-resolve audience from saved filter and send again.
      const resolved = await resolveCampaignAudience(campaign.branch_id, campaign.audience_filter || {});
      const { total } = await sendCampaignNow(campaign, { recipients: resolved });
      return total;
    },
    onSuccess: (total) => {
      toast.success(`Re-triggered — queued ${total} recipients`);
      setConfirmRetrigger(false);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Re-trigger failed'),
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      if (!campaign) throw new Error('no campaign');
      const { data, error } = await supabase.rpc('reset_campaign_to_draft' as any, { p_campaign_id: campaign.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Campaign reset to Draft — you can re-trigger it now');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Reset failed'),
  });

  if (!campaign) return null;

  const isSending = campaign.status === 'sending';
  // A "zombie" send: status stuck at sending but no recipients ever landed AND
  // the campaign is older than 15 min — the wizard call to send-broadcast must
  // have aborted client-side before any recipient rows were written.
  const isZombieSending =
    isSending &&
    ((campaign as any).recipients_count ?? 0) === 0 &&
    (Date.now() - new Date(campaign.created_at).getTime()) > 15 * 60_000;
  const isLoading = recLoading || logsLoading;
  const progressPct = counts.total > 0
    ? Math.min(100, Math.round(((counts.sent + counts.failed + counts.skipped) / counts.total) * 100))
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8">{campaign.name}</SheetTitle>
          <SheetDescription>
            Full delivery breakdown for this campaign. Live Feed shows only 1:1 transactional messages.
          </SheetDescription>
        </SheetHeader>

        {/* Action bar */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm" variant="outline" className="rounded-xl gap-2"
            onClick={() => reconcileMut.mutate()}
            disabled={reconcileMut.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reconcileMut.isPending ? 'animate-spin' : ''}`} />
            Reconcile now
          </Button>
          <Button
            size="sm" variant="outline" className="rounded-xl gap-2"
            onClick={() => retryMut.mutate()}
            disabled={retryMut.isPending || isSending || counts.failed === 0}
            title={counts.failed === 0 ? 'No failed recipients' : `Retry ${counts.failed} failed`}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${retryMut.isPending ? 'animate-spin' : ''}`} />
            Retry failed ({counts.failed})
          </Button>
          <Button
            size="sm" className="rounded-xl gap-2 bg-primary hover:bg-primary text-primary-foreground"
            onClick={() => setConfirmRetrigger(true)}
            disabled={retriggerMut.isPending || (isSending && !isZombieSending)}
          >
            <Repeat className="h-3.5 w-3.5" />
            Re-trigger to all
          </Button>
          {isZombieSending && (
            <Button
              size="sm" variant="destructive" className="rounded-xl gap-2"
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
              title="Wizard aborted before any recipient rows were written. Reset back to draft so you can re-send."
            >
              <RotateCcw className={`h-3.5 w-3.5 ${resetMut.isPending ? 'animate-spin' : ''}`} />
              Reset to Draft (stuck)
            </Button>
          )}
        </div>

        {isZombieSending && (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200">
            <strong>Stuck in "sending":</strong> no recipients were dispatched. The wizard call
            to <code>send-broadcast</code> aborted before any messages went out — usually because
            the browser tab was closed or the audience resolver failed. Click <em>Reset to Draft</em>,
            then re-open the campaign and hit Send again.
          </div>
        )}

        <div className="mt-5 space-y-5">
          {/* KPI strip: 5 tiles */}
          <div className="grid grid-cols-5 gap-2">
            <KpiTile icon={Users} label="Total" value={counts.total} tone="muted" />
            <KpiTile icon={Send} label="Sent" value={counts.sent} tone="info" />
            <KpiTile icon={CheckCircle2} label="Delivered" value={counts.delivered} tone="success" />
            <KpiTile icon={Eye} label="Read" value={counts.read} tone="primary" />
            <KpiTile icon={XCircle} label="Failed" value={counts.failed} tone="destructive" />
          </div>

          {isSending && counts.total > 0 && (
            <div>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                <span>Sending in background</span>
                <span>{counts.sent + counts.failed}/{counts.total} · {progressPct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Stats auto-reconcile every 2 minutes from provider delivery receipts. Use <em>Reconcile now</em> to refresh instantly.
          </p>

          {/* Filter chips + search */}
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'delivered', 'failed', 'pending'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                  filter === k
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:bg-muted'
                }`}
              >
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 rounded-xl text-xs"
                placeholder="Search name, phone or email"
              />
            </div>
          </div>

          {/* Recipient list */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Recipients ({filtered.length}{filtered.length !== counts.total ? ` of ${counts.total}` : ''})
            </h4>
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {counts.total === 0 ? 'No recipients yet.' : 'No recipients match this filter.'}
              </p>
            ) : (
              <TooltipProvider>
                <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
                  {filtered.map((r) => {
                    const ChanIcon = channelIcon(campaign.channel);
                    const displayContact =
                      campaign.channel === 'email'
                        ? r.email || '—'
                        : formatPhoneDisplay(r.phone || '') || r.phone || r.email || '—';
                    return (
                      <div
                        key={r.id}
                        className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg bg-card border border-border/50 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <ChanIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                            <p className="font-medium truncate text-foreground">
                              {r.full_name || 'Unknown'}
                            </p>
                            {r.attempt > 1 && (
                              <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0">
                                retry ×{r.attempt}
                              </Badge>
                            )}
                            {(r as any).fallback_used && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0 border-amber-300 bg-amber-50 text-amber-700">
                                    paced → {(r as any).fallback_channel || 'sms'}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">
                                    Meta paced this WhatsApp send (code {(r as any).pacing_code || '131049'}) — automatically re-sent via {(r as any).fallback_channel || 'RCS/SMS'}.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>

                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {displayContact}
                          </p>
                          {r.final === 'failed' && r.errorLabel && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-[11px] text-destructive truncate mt-1 cursor-help">
                                  {r.errorLabel}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-xs break-words">{r.errorRaw}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge className={`${statusBadgeClass(r.final)} rounded-full text-[10px] uppercase gap-1`}>
                            <StatusIcon s={r.final} />
                            {r.final}
                          </Badge>
                          {r.timestamp && (
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(r.timestamp), 'dd MMM HH:mm')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Re-trigger confirmation */}
        {confirmRetrigger && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmRetrigger(false)}>
            <div className="bg-card rounded-2xl p-5 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-foreground mb-1">Re-trigger campaign?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This will re-resolve the saved audience and re-send to <strong>all</strong> matching recipients — including those already delivered. Use <em>Retry failed</em> to re-send only failures.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="rounded-xl" onClick={() => setConfirmRetrigger(false)} disabled={retriggerMut.isPending}>
                  Cancel
                </Button>
                <Button className="rounded-xl bg-primary hover:bg-primary text-primary-foreground" onClick={() => retriggerMut.mutate()} disabled={retriggerMut.isPending}>
                  {retriggerMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-trigger'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function KpiTile({
  icon: Icon, label, value, tone,
}: {
  icon: any; label: string; value: number;
  tone: 'muted' | 'success' | 'destructive' | 'warning' | 'info' | 'primary';
}) {
  const toneMap: Record<string, string> = {
    muted: 'bg-muted text-foreground',
    success: 'bg-success/10 text-success',
    destructive: 'bg-destructive/10 text-destructive',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
    primary: 'bg-primary/10 text-primary',
  };
  return (
    <div className={`rounded-xl ${toneMap[tone]} p-3 text-center`}>
      <Icon className="h-4 w-4 mx-auto mb-1 opacity-80" />
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] uppercase opacity-80">{label}</p>
    </div>
  );
}
