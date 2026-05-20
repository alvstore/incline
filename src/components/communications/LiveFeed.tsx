import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronDown, ChevronRight, Search, MessageSquare, Mail, Phone, Bell,
  CheckCircle2, XCircle, Clock, Send, Eye, MessageSquareReply, Loader2, ArrowDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { DeliveryTimeline } from './DeliveryTimeline';
import { KpiStrip, type KpiCounts } from './KpiStrip';
import { formatPhoneDisplay, phoneVariants } from '@/lib/contacts/phone';

type ChannelKey = 'all' | 'whatsapp' | 'sms' | 'email' | 'in_app';

const channelMeta: Record<string, { icon: any; color: string; label: string }> = {
  whatsapp: { icon: MessageSquare, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10', label: 'WhatsApp' },
  sms: { icon: Phone, color: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10', label: 'SMS' },
  email: { icon: Mail, color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10', label: 'Email' },
  in_app: { icon: Bell, color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10', label: 'In-App' },
};

const statusBadge = (s: string) => {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    sent: { cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30', icon: Send, label: 'Sent' },
    delivered: { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', icon: CheckCircle2, label: 'Delivered' },
    read: { cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30', icon: Eye, label: 'Read' },
    replied: { cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30', icon: MessageSquareReply, label: 'Replied' },
    failed: { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30', icon: XCircle, label: 'Failed' },
    bounced: { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30', icon: XCircle, label: 'Bounced' },
    pending: { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', icon: Clock, label: 'Pending' },
    queued: { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', icon: Clock, label: 'Queued' },
  };
  const m = map[s] || { cls: 'bg-muted text-muted-foreground border-border', icon: Clock, label: s };
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn('rounded-full gap-1 font-medium', m.cls)}>
      <Icon className="h-3 w-3" />{m.label}
    </Badge>
  );
};

const normalizeStatus = (log: any): string => {
  const status = (log.status || '').toLowerCase();
  const delivery = (log.delivery_status || '').toLowerCase();
  // Honour terminal statuses first — they are written by the dispatcher
  if (status === 'failed' || status === 'bounced') return status;
  if (delivery === 'failed' || delivery === 'bounced') return delivery;
  // Honour delivery progressions (delivered/read/replied) when they exist
  if (['delivered', 'read', 'replied'].includes(delivery)) return delivery;
  // status='sent' wins over a stale delivery_status='scheduled'
  if (status === 'sent') return 'sent';
  // Otherwise fall back to whatever non-scheduled delivery info we have
  if (delivery && delivery !== 'scheduled') return delivery;
  if (status) return status;
  return 'pending';
};

const PAGE_SIZE_KEY = 'comm-live-feed-page-size';
const PAGE_SIZES = [50, 100, 200] as const;
type PageSize = typeof PAGE_SIZES[number];

export function LiveFeed({ branchId }: { branchId?: string }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<ChannelKey>('all');
  const [statusFilter, setStatusFilter] = useState<string>('total');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [pageSize, setPageSize] = useState<PageSize>(() => {
    if (typeof window === 'undefined') return 100;
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(stored) ? (stored as PageSize) : 100;
  });
  useEffect(() => {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(pageSize)); } catch {}
  }, [pageSize]);

  // Older pages, appended after the realtime page-1 query.
  const [olderPages, setOlderPages] = useState<any[][]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);

  const { data: page1 = [], isLoading } = useQuery({
    queryKey: ['comm-live-feed', branchId, pageSize],
    queryFn: async () => {
      let q = supabase
        .from('communication_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(pageSize);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Reset pagination whenever the base page1 query key changes.
  useEffect(() => {
    setOlderPages([]);
    setReachedEnd(false);
  }, [branchId, pageSize]);

  const logs = useMemo(() => [...page1, ...olderPages.flat()], [page1, olderPages]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || reachedEnd) return;
    const last = logs[logs.length - 1];
    if (!last?.created_at) return;
    setLoadingOlder(true);
    try {
      let q = supabase
        .from('communication_logs')
        .select('*')
        .lt('created_at', last.created_at)
        .order('created_at', { ascending: false })
        .limit(pageSize);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      if (rows.length > 0) setOlderPages((p) => [...p, rows]);
      if (rows.length < pageSize) setReachedEnd(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [branchId, pageSize, logs, loadingOlder, reachedEnd]);


  const [livePulse, setLivePulse] = useState(0);

  // Batched name lookup keyed by member_id and by normalized phone/email.
  const logIdsKey = (logs as any[]).map((l) => l.id).join(',');
  const { data: nameMap = {} } = useQuery<Record<string, string>>({
    queryKey: ['comm-live-feed-names', logIdsKey],
    enabled: logs.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const memberIds = Array.from(new Set((logs as any[]).map((l) => l.member_id).filter(Boolean))) as string[];
      const phoneSet = new Set<string>();
      const emailSet = new Set<string>();
      for (const l of logs as any[]) {
        if (l.member_id) continue;
        if (l.type === 'whatsapp' || l.type === 'sms') {
          for (const v of phoneVariants(l.recipient)) phoneSet.add(v);
        } else if (l.type === 'email' && l.recipient) {
          emailSet.add(String(l.recipient).toLowerCase());
        }
      }
      const phones = Array.from(phoneSet);
      const emails = Array.from(emailSet);

      const map: Record<string, string> = {};
      const setName = (key: string | null | undefined, name: string | null | undefined) => {
        if (!key || !name) return;
        const k = String(key).toLowerCase();
        if (!map[k]) map[k] = name;
      };

      // 1. Members → profiles via user_id
      if (memberIds.length) {
        const { data: members } = await (supabase as any)
          .from('members')
          .select('id, user_id')
          .in('id', memberIds);
        const userIds = (members || []).map((m: any) => m.user_id).filter(Boolean);
        if (userIds.length) {
          const { data: profs } = await (supabase as any)
            .from('profiles')
            .select('id, full_name, phone, email')
            .in('id', userIds);
          const byUser: Record<string, any> = {};
          for (const p of profs || []) byUser[p.id] = p;
          for (const m of members || []) {
            const p = byUser[m.user_id];
            if (!p) continue;
            setName(m.id, p.full_name);
            for (const v of phoneVariants(p.phone)) setName(v, p.full_name);
            if (p.email) setName(p.email, p.full_name);
          }
        }
      }

      // 2. Phone-based fallbacks: profiles, leads, whatsapp_messages.contact_name
      if (phones.length) {
        await Promise.all([
          (supabase as any)
            .from('profiles')
            .select('full_name, phone')
            .in('phone', phones)
            .then(({ data }: any) => {
              for (const p of data || []) {
                for (const v of phoneVariants(p.phone)) setName(v, p.full_name);
              }
            }),
          (supabase as any)
            .from('leads')
            .select('full_name, phone')
            .in('phone', phones)
            .then(({ data }: any) => {
              for (const l of data || []) {
                for (const v of phoneVariants(l.phone)) setName(v, l.full_name);
              }
            }),
          (supabase as any)
            .from('whatsapp_messages')
            .select('contact_name, phone_number')
            .in('phone_number', phones)
            .not('contact_name', 'is', null)
            .limit(500)
            .then(({ data }: any) => {
              for (const c of data || []) {
                for (const v of phoneVariants(c.phone_number)) setName(v, c.contact_name);
              }
            }),
        ]);
      }

      // 3. Email-based fallback
      if (emails.length) {
        const { data } = await (supabase as any)
          .from('profiles')
          .select('full_name, email')
          .in('email', emails);
        for (const p of data || []) setName(p.email, p.full_name);
      }

      return map;
    },
  });

  function resolveName(log: any): string | null {
    if (log.member_id) {
      const n = nameMap[String(log.member_id).toLowerCase()];
      if (n) return n;
    }
    if (log.type === 'whatsapp' || log.type === 'sms') {
      for (const v of phoneVariants(log.recipient)) {
        const n = nameMap[v.toLowerCase()];
        if (n) return n;
      }
    }
    if (log.recipient) {
      const n = nameMap[String(log.recipient).toLowerCase()];
      if (n) return n;
    }
    return null;
  }

  useEffect(() => {
    const invalidate = () => {
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'comm-live-feed' });
      setLivePulse((p) => p + 1);
    };
    const ch = supabase
      .channel('comm-live-feed-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'communication_logs' }, invalidate)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communication_delivery_events' }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const counts: KpiCounts = useMemo(() => {
    const c: KpiCounts = { total: logs.length, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, pending: 0 };
    for (const l of logs as any[]) {
      const s = normalizeStatus(l);
      if (s === 'sent') c.sent++;
      else if (s === 'delivered') c.delivered++;
      else if (s === 'read') c.read++;
      else if (s === 'replied') c.replied++;
      else if (s === 'failed' || s === 'bounced') c.failed++;
      else c.pending++;
    }
    // Sent should be cumulative of all that left the queue
    c.sent = c.sent + c.delivered + c.read + c.replied;
    return c;
  }, [logs]);

  const channelCounts = useMemo(() => {
    const c = { all: 0, whatsapp: 0, sms: 0, email: 0, in_app: 0 } as Record<string, number>;
    for (const l of logs as any[]) {
      c.all++;
      if (l.type && c[l.type] !== undefined) c[l.type]++;
    }
    return c;
  }, [logs]);

  const filtered = useMemo(() => {
    return (logs as any[]).filter((l) => {
      if (channel !== 'all' && l.type !== channel) return false;
      const s = normalizeStatus(l);
      if (statusFilter !== 'total') {
        if (statusFilter === 'sent' && !['sent', 'delivered', 'read', 'replied'].includes(s)) return false;
        if (statusFilter === 'failed' && !['failed', 'bounced'].includes(s)) return false;
        if (!['sent', 'failed'].includes(statusFilter) && s !== statusFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!(`${l.recipient || ''} ${l.subject || ''} ${l.content || ''}`).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [logs, channel, statusFilter, search]);

  return (
    <div className="space-y-4">
      <KpiStrip counts={counts} activeKey={statusFilter} onSelect={setStatusFilter} />

      <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5 overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-card to-muted/20 border-b border-border/50">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </div>
              <span className="text-sm font-semibold text-foreground">Live Feed</span>
              <Badge variant="outline" className="rounded-full text-[10px] tabular-nums">{filtered.length}</Badge>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search recipient, subject…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 rounded-xl w-full sm:w-64"
                />
              </div>
              <Tabs value={channel} onValueChange={(v) => setChannel(v as ChannelKey)}>
                <TabsList className="rounded-xl bg-muted/50 h-9">
                  <TabsTrigger value="all" className="rounded-lg text-xs h-7 gap-1.5">
                    All <Badge variant="secondary" className="rounded-full px-1.5 h-4 text-[10px] tabular-nums">{channelCounts.all}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="whatsapp" className="rounded-lg text-xs h-7 gap-1.5">
                    <MessageSquare className="h-3 w-3" /> WA <Badge variant="secondary" className="rounded-full px-1.5 h-4 text-[10px] tabular-nums">{channelCounts.whatsapp}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="sms" className="rounded-lg text-xs h-7 gap-1.5">
                    <Phone className="h-3 w-3" /> SMS <Badge variant="secondary" className="rounded-full px-1.5 h-4 text-[10px] tabular-nums">{channelCounts.sms}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="email" className="rounded-lg text-xs h-7 gap-1.5">
                    <Mail className="h-3 w-3" /> Email <Badge variant="secondary" className="rounded-full px-1.5 h-4 text-[10px] tabular-nums">{channelCounts.email}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="in_app" className="rounded-lg text-xs h-7 gap-1.5">
                    <Bell className="h-3 w-3" /> In-App <Badge variant="secondary" className="rounded-full px-1.5 h-4 text-[10px] tabular-nums">{channelCounts.in_app}</Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-border/50">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-9 w-9 rounded-xl flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-3.5 w-32 rounded-full" />
                      <Skeleton className="h-3 w-24 rounded-full" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-3/4 rounded-full" />
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-3 w-12 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                <Send className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium">No messages</p>
              <p className="text-xs text-muted-foreground">Adjust filters or send a broadcast</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="divide-y divide-border/50">
                {filtered.map((log: any, i: number) => {
                  const ch = channelMeta[log.type] || channelMeta.in_app;
                  const Icon = ch.icon;
                  const status = normalizeStatus(log);
                  const isOpen = expanded === log.id;
                  const name = resolveName(log);
                  const isPhone = log.type === 'whatsapp' || log.type === 'sms';
                  const recipientDisplay = isPhone ? formatPhoneDisplay(log.recipient) || log.recipient : log.recipient;
                  return (
                    <div key={log.id} style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }} className="animate-fade-in">
                      <button
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                        className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors overflow-hidden"
                      >
                        <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0', ch.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-semibold text-foreground truncate min-w-0">
                              {name || <span className="text-muted-foreground italic">Unknown</span>}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums truncate hidden sm:inline-block max-w-[160px]">{recipientDisplay}</span>
                            <Badge variant="outline" className="rounded-full text-[10px] capitalize flex-shrink-0">{ch.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5 pr-2">
                            {log.subject ? <span className="font-medium text-foreground/80">{log.subject} · </span> : null}
                            {log.content}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-auto">
                          {statusBadge(status)}
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {format(new Date(log.created_at), 'HH:mm:ss')}
                          </span>
                        </div>
                        <div className="text-muted-foreground/60 flex-shrink-0">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="bg-muted/20 border-t border-border/50 animate-accordion-down">
                          <DeliveryTimeline
                            logId={log.id}
                            createdAt={log.created_at}
                            logStatus={log.status}
                            logDeliveryStatus={log.delivery_status}
                            logSentAt={log.sent_at}
                            logErrorMessage={log.error_message}
                          />
                          {log.error_message && (
                            <div className="px-4 pb-3 text-xs text-rose-600 dark:text-rose-400">
                              <strong>Error:</strong> {log.error_message}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {!isLoading && logs.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between border-t border-border/50 bg-muted/20 px-4 py-2.5">
              <div className="text-xs text-muted-foreground tabular-nums">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {logs.length} loaded
                {logs.length > 0 && (
                  <> · oldest: {format(new Date(logs[logs.length - 1].created_at), 'd MMM, HH:mm')}</>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-background border border-border/60 p-0.5">
                  {PAGE_SIZES.map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setPageSize(sz)}
                      className={cn(
                        'text-[11px] font-medium px-2 py-1 rounded-md transition-colors tabular-nums',
                        pageSize === sz
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      aria-label={`Page size ${sz}`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadOlder}
                  disabled={loadingOlder || reachedEnd}
                  className="h-8 rounded-xl gap-1.5 text-xs"
                >
                  {loadingOlder ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
                  ) : reachedEnd ? (
                    'No older messages'
                  ) : (
                    <><ArrowDown className="h-3.5 w-3.5" /> Load older</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>

  );
}
