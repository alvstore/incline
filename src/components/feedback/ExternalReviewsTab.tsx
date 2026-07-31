import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Star, RefreshCw, Send, AlertTriangle, ShieldAlert, Sparkles, MessageSquare, ExternalLink, Loader2, Stethoscope, CheckCircle2, XCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';

const CLASSIFICATION_BADGE: Record<string, { label: string; cls: string; icon: any }> = {
  pending:           { label: 'AI pending',      cls: 'bg-muted text-muted-foreground',     icon: Loader2 },
  genuine:           { label: 'Genuine',         cls: 'bg-success/15 text-success', icon: Sparkles },
  unhappy_member:    { label: 'Unhappy member',  cls: 'bg-warning/15 text-warning',     icon: AlertTriangle },
  suspected_fake:    { label: 'Suspected fake',  cls: 'bg-destructive/15 text-destructive',         icon: ShieldAlert },
  spam:              { label: 'Spam',            cls: 'bg-destructive/15 text-destructive',         icon: ShieldAlert },
};

const REPLY_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-muted text-muted-foreground' },
  approved:  { label: 'Approved',  cls: 'bg-info/15 text-info' },
  sent:      { label: 'Replied',   cls: 'bg-success/15 text-success' },
  reported:  { label: 'Reported',  cls: 'bg-destructive/15 text-destructive' },
  dismissed: { label: 'Dismissed', cls: 'bg-muted text-muted-foreground' },
};

interface InboundRow {
  id: string;
  branch_id: string;
  google_review_id: string;
  author_name: string | null;
  rating: number | null;
  review_text: string | null;
  posted_at: string | null;
  match_type: string;
  matched_member_id: string | null;
  matched_lead_id: string | null;
  match_evidence: any;
  ai_classification: string;
  ai_reasoning: string | null;
  ai_draft_reply: string | null;
  reply_status: string;
  reply_text: string | null;
  google_reply_text: string | null;
  replied_at: string | null;
}

export default function ExternalReviewsTab() {
  const { effectiveBranchId: branchId = '' } = useBranchContext();
  const qc = useQueryClient();
  const [classFilter, setClassFilter] = useState('all');
  const [replyFilter, setReplyFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Branch Google integration health
  const { data: integration } = useQuery({
    queryKey: ['gri-integration', branchId],
    queryFn: async () => {
      if (!branchId) return null;
      const { data } = await (supabase as any)
        .from('integration_settings')
        .select('is_active, config')
        .eq('integration_type', 'google_business')
        .eq('provider', 'google_business')
        .eq('branch_id', branchId)
        .maybeSingle();
      return data as { is_active: boolean; config: any } | null;
    },
    enabled: !!branchId,
  });

  const { data: rows = [], isLoading, refetch } = useQuery<InboundRow[]>({
    queryKey: ['gri', branchId, classFilter, replyFilter, ratingFilter],
    queryFn: async () => {
      if (!branchId) return [];
      let q = supabase
        .from('google_reviews_inbound')
        .select('*')
        .eq('branch_id', branchId)
        .order('posted_at', { ascending: false, nullsFirst: false })
        .limit(200);
      if (classFilter !== 'all') q = q.eq('ai_classification', classFilter);
      if (replyFilter !== 'all') q = q.eq('reply_status', replyFilter);
      if (ratingFilter !== 'all') q = q.eq('rating', Number(ratingFilter));
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InboundRow[];
    },
    enabled: !!branchId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!branchId) return;
    const ch = supabase
      .channel(`gri-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'google_reviews_inbound', filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ['gri'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branchId, qc]);

  const stats = useMemo(() => {
    const cutoff = subDays(new Date(), 7).getTime();
    const recent = rows.filter(r => r.posted_at && new Date(r.posted_at).getTime() >= cutoff);
    const avg = recent.length ? (recent.reduce((s, r) => s + (r.rating ?? 0), 0) / recent.length).toFixed(1) : '0';
    const fakes = rows.filter(r => r.ai_classification === 'suspected_fake' || r.ai_classification === 'spam').length;
    const pending = rows.filter(r => r.reply_status === 'draft' || r.reply_status === 'approved').length;
    return { week: recent.length, avg, fakes, pending };
  }, [rows]);

  const fetchNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'fetch_reviews', branch_id: branchId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Fetched latest Google reviews'); refetch(); },
    onError: (e: any) => toast.error(e?.message ?? 'Fetch failed'),
  });

  const reclassify = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'classify', inbound_id: id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('AI re-analysed'); refetch(); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const sendReply = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'reply', inbound_id: id, reply_text: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => { toast.success('Reply posted to Google'); refetch(); },
    onError: (e: any) => toast.error(e?.message ?? 'Reply failed'),
  });

  const updateRow = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from('google_reviews_inbound').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => refetch(),
  });

  const ratingColor = (r: number | null) => (r ?? 0) >= 4 ? 'text-success' : (r ?? 0) >= 3 ? 'text-warning' : 'text-destructive';

  if (!branchId) {
    return <Card className="rounded-2xl"><CardContent className="py-8 text-center text-muted-foreground">Select a branch to view external reviews.</CardContent></Card>;
  }

  const notConfigured = !integration?.is_active || !integration?.config?.account_id || !integration?.config?.location_id;

  return (
    <div className="space-y-6">
      {notConfigured && (
        <Card className="rounded-2xl border-warning/25 bg-warning/10">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-warning">Google Business not configured for this branch</p>
              <p className="text-sm text-warning">Configure under Settings → Integrations → Google Business to start fetching reviews and posting replies.</p>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="/settings?tab=integrations">Configure</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard title="Inbound this week" value={stats.week} icon={MessageSquare} />
        <StatCard title="Avg incoming rating" value={stats.avg} icon={Star} variant={Number(stats.avg) >= 4 ? 'success' : Number(stats.avg) >= 3 ? 'warning' : 'destructive'} />
        <StatCard title="Suspected fakes" value={stats.fakes} icon={ShieldAlert} variant={stats.fakes > 0 ? 'destructive' : 'default'} />
        <StatCard title="Replies pending" value={stats.pending} icon={Send} variant={stats.pending > 0 ? 'warning' : 'default'} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All AI verdicts</SelectItem>
            {Object.entries(CLASSIFICATION_BADGE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={replyFilter} onValueChange={setReplyFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reply states</SelectItem>
            {Object.entries(REPLY_STATUS_BADGE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ratings</SelectItem>
            {[5,4,3,2,1].map(n => <SelectItem key={n} value={String(n)}>{n} ★</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => fetchNow.mutate()} disabled={fetchNow.isPending} className="cursor-pointer">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${fetchNow.isPending ? 'animate-spin' : ''}`} />
          Fetch now
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => diagnose.mutate()}
          disabled={diagnose.isPending}
          className="cursor-pointer"
        >
          <Stethoscope className={`h-4 w-4 mr-1.5 ${diagnose.isPending ? 'animate-pulse' : ''}`} />
          Diagnose
        </Button>
      </div>

      {/* Diagnostics */}
      {diagnosis && (
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Google connection diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(diagnosis.checks ?? []).map((c: any) => (
              <div key={c.key} className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-muted/50">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  {!c.ok && c.hint && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.hint}</p>
                  )}
                </div>
              </div>
            ))}
            {diagnosis.places?.rating != null && (
              <p className="pt-1 text-xs text-muted-foreground">
                Public Google rating: <strong>{diagnosis.places.rating}</strong> from{' '}
                {diagnosis.places.total_ratings ?? 0} ratings (Places fallback).
              </p>
            )}
          </CardContent>
        </Card>
      )}


      {/* Reviews list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
          No external reviews yet. Click "Fetch now" once Google Business is configured.
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const cb = CLASSIFICATION_BADGE[r.ai_classification] ?? CLASSIFICATION_BADGE.pending;
            const rb = REPLY_STATUS_BADGE[r.reply_status] ?? REPLY_STATUS_BADGE.draft;
            const draftValue = drafts[r.id] ?? r.reply_text ?? r.ai_draft_reply ?? '';
            const Icon = cb.icon;
            return (
              <Card key={r.id} className="rounded-2xl shadow-lg shadow/50">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{r.author_name ?? 'Anonymous'}</p>
                        <div className={`flex items-center gap-0.5 ${ratingColor(r.rating)}`}>
                          {[...Array(5)].map((_, i) => <Star key={i} className={`h-4 w-4 ${i < (r.rating ?? 0) ? 'fill-current' : 'text-muted'}`} />)}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.posted_at ? format(new Date(r.posted_at), 'dd MMM yyyy, HH:mm') : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={cb.cls}><Icon className="h-3 w-3 mr-1" />{cb.label}</Badge>
                      <Badge className={rb.cls}>{rb.label}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{r.review_text || <em className="text-muted-foreground">No text</em>}</p>

                  {/* Match & evidence */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {r.match_type === 'member' && (
                      <Badge className="bg-success/10 text-success">Active member: {r.match_evidence?.name} · {r.match_evidence?.lifecycle_state ?? r.match_evidence?.status ?? 'unknown'}</Badge>
                    )}
                    {r.match_type === 'lead' && (
                      <Badge className="bg-info/10 text-info">Lead: {r.match_evidence?.name} · source {r.match_evidence?.source ?? '—'} · {r.match_evidence?.status ?? '—'}</Badge>
                    )}
                    {r.match_type === 'none' && (
                      <Badge className="bg-muted text-muted-foreground">No record found in this branch</Badge>
                    )}
                  </div>

                  {/* AI reasoning */}
                  {r.ai_reasoning && (
                    <div className="rounded-xl bg-muted p-3 text-sm text-foreground">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">AI reasoning</p>
                      {r.ai_reasoning}
                    </div>
                  )}

                  {/* Reply box */}
                  {r.reply_status !== 'sent' && r.reply_status !== 'dismissed' && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Draft reply (editable)</p>
                      <Textarea
                        value={draftValue}
                        onChange={(e) => setDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                        rows={3}
                        className="rounded-xl"
                        placeholder="Write a reply or click Generate to draft with AI"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => sendReply.mutate({ id: r.id, text: draftValue })}
                          disabled={!draftValue.trim() || sendReply.isPending || notConfigured}
                        >
                          <Send className="h-3.5 w-3.5 mr-1.5" />Post reply to Google
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => reclassify.mutate(r.id)} disabled={reclassify.isPending}>
                          <Sparkles className="h-3.5 w-3.5 mr-1.5" />Re-analyse with AI
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateRow.mutate({ id: r.id, patch: { reply_status: 'reported', reported_to_google_at: new Date().toISOString() } })}>
                          <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />Mark as reported
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => updateRow.mutate({ id: r.id, patch: { reply_status: 'dismissed' } })}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  )}

                  {r.reply_status === 'sent' && r.google_reply_text && (
                    <div className="rounded-xl bg-success/10 p-3 text-sm">
                      <p className="text-xs font-semibold text-success uppercase tracking-wider mb-1 flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" /> Replied on Google {r.replied_at ? `· ${format(new Date(r.replied_at), 'dd MMM yyyy')}` : ''}
                      </p>
                      <p className="text-foreground whitespace-pre-wrap">{r.google_reply_text}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
