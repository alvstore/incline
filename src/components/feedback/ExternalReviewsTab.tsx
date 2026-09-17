import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, RefreshCw, Send, AlertTriangle, ShieldAlert, Sparkles, MessageSquare, ExternalLink, Loader2, Stethoscope, CheckCircle2, XCircle, Copy, Clock3 } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils/clipboard';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import GoogleBusinessDrawer from '@/components/settings/GoogleBusinessDrawer';
import GoogleConnectionBanner, { type GoogleConnState } from './GoogleConnectionBanner';

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
  source?: string | null;
  draft_reply?: string | null;
  review_permalink?: string | null;
  relative_time?: string | null;
  reply_mode?: string | null;

}

function StarRow({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${cls} ${i <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

function initialsOf(name?: string | null) {
  const parts = (name ?? 'Anonymous').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'A';
}

export default function ExternalReviewsTab() {
  const { effectiveBranchId: branchId = '', branches } = useBranchContext();
  const qc = useQueryClient();
  const [classFilter, setClassFilter] = useState('all');
  const [replyFilter, setReplyFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [openReply, setOpenReply] = useState<Record<string, boolean>>({});
  const branchName = (branches ?? []).find((b: any) => b.id === branchId)?.name ?? 'this branch';

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

  // Live connection health — drives the banner and the reply-button gating.
  const {
    data: conn,
    isFetching: connChecking,
    refetch: recheckConn,
  } = useQuery({
    queryKey: ['gri-conn', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'diagnose', branch_id: branchId },
      });
      if (error) throw error;
      return data as { ok?: boolean; checks?: any[]; places?: any };
    },
    enabled: !!branchId,
    staleTime: 5 * 60 * 1000,
    retry: false,
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
    const rated = rows.filter(r => r.rating != null);
    const localAvg = rated.length ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length : 0;
    const fakes = rows.filter(r => r.ai_classification === 'suspected_fake' || r.ai_classification === 'spam').length;
    const pending = rows.filter(r => r.reply_status === 'draft' || r.reply_status === 'approved').length;
    const replied = rows.filter(r => r.reply_status === 'sent').length;
    return { week: recent.length, localAvg, fakes, pending, replied, total: rows.length };
  }, [rows]);

  // Google's own aggregate (persisted by the reviews brain) beats a local mean.
  const googleRating = (integration?.config as any)?.place_rating;
  const googleCount = (integration?.config as any)?.place_rating_count;
  const avgRating = googleRating != null ? Number(googleRating) : stats.localAvg;
  const totalReviews = googleCount != null ? Number(googleCount) : stats.total;

  const [diagnosis, setDiagnosis] = useState<any>(null);
  const diagnose = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'diagnose', branch_id: branchId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      setDiagnosis(d);
      if ((d as any)?.ok) toast.success('Google connection is healthy');
      else toast.warning('Found issues with the Google connection');
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Diagnostics failed'),
  });

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

  // Pulls owner replies that were posted on Google Maps / the GBP app so the
  // pending count reflects reality instead of only replies sent from here.
  const syncReplies = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'sync_replies', branch_id: branchId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (d) => {
      const n = Number(d?.replies_synced ?? 0);
      toast.success(n > 0 ? `${n} reply${n === 1 ? '' : 's'} found on Google and marked replied` : 'No new replies found on Google');
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not sync replies from Google'),
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

  const [replyingId, setReplyingId] = useState<string | null>(null);
  const sendReply = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'reply', inbound_id: id, reply_text: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return { id, text };
    },
    onMutate: ({ id }) => setReplyingId(id),
    onSettled: () => setReplyingId(null),
    onSuccess: ({ id, text }) => {
      // Optimistic flip so the card reads "Replied" with no refresh.
      qc.setQueriesData({ queryKey: ['gri'] }, (old: any) =>
        Array.isArray(old)
          ? old.map((row: InboundRow) =>
              row.id === id
                ? { ...row, reply_status: 'sent', reply_mode: 'api', reply_text: text, google_reply_text: text, replied_at: new Date().toISOString() }
                : row,
            )
          : old,
      );
      setOpenReply((o) => ({ ...o, [id]: false }));
      toast.success('Reply posted successfully');
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to post reply. Please try again.'),
  });

  const saveDraft = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: string }) => {
      const { error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'save_draft', inbound_id: id, draft },
      });
      if (error) throw error;
    },
  });

  // Draft-only AI generation — writes into the editable box without touching
  // the classification or the match evidence.
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const draftWithAI = useMutation({
    mutationFn: async ({ id, tone }: { id: string; tone?: string }) => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'draft_reply', inbound_id: id, tone },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (!(data as any)?.draft) throw new Error('The AI did not return a reply — try again.');
      return { id, draft: (data as any).draft as string };
    },
    onMutate: ({ id }) => setDraftingId(id),
    onSettled: () => setDraftingId(null),
    onSuccess: ({ id, draft }) => {
      setDrafts((d) => ({ ...d, [id]: draft }));
      toast.success('Draft ready — edit it before posting');
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not draft the reply'),
  });


  // Assisted reply — used while Business Profile posting access is pending.
  const markReplied = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke('google-reviews-brain', {
        body: { action: 'mark_replied_externally', inbound_id: id, reply_text: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => { toast.success('Marked as replied on Google'); refetch(); },
    onError: (e: any) => toast.error(e?.message ?? 'Could not update the review'),
  });



  const updateRow = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from('google_reviews_inbound').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => refetch(),
  });

  

  if (!branchId) {
    return <Card className="rounded-2xl"><CardContent className="py-8 text-center text-muted-foreground">Select a branch to view external reviews.</CardContent></Card>;
  }

  const checks = (conn?.checks ?? []) as Array<{ key: string; ok: boolean; lane: 'places' | 'business_profile'; label: string; hint?: string }>;
  const gbpChecks = checks.filter((c) => c.lane === 'business_profile');
  const placesOk = checks.some((c) => c.key === 'places_fetch' && c.ok);
  const gbpOk = gbpChecks.length > 0 && gbpChecks.every((c) => c.ok);
  const connState: GoogleConnState = !conn
    ? 'unknown'
    : gbpOk
      ? 'live'
      : placesOk || integration?.is_active
        ? 'read_only'
        : 'not_configured';
  const canReply = connState === 'live';
  const notConfigured = connState === 'not_configured';
  // Fallback deep link when a single review has no permalink of its own.
  const cfg = (integration?.config ?? {}) as Record<string, any>;
  const placeUri: string | null =
    cfg.place_uri ??
    (cfg.place_id ? `https://search.google.com/local/reviews?placeid=${cfg.place_id}` : null);


  return (
    <div className="space-y-6">
      <GoogleConnectionBanner
        state={connState}
        checks={checks}
        isChecking={connChecking}
        isFetching={fetchNow.isPending}
        onConnect={() => setConnectOpen(true)}
        onRecheck={() => { recheckConn(); }}
        onFetch={() => fetchNow.mutate()}
      />

      {/* Summary */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {/* Average rating — hero */}
        <Card className="rounded-2xl border-0 bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/30">
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Average rating</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-3xl font-bold leading-none">{avgRating ? avgRating.toFixed(1) : '—'}</span>
              <span className="pb-0.5 text-xs text-white/70">out of 5</span>
            </div>
            <div className="mt-3 flex items-center gap-0.5" aria-label={`${avgRating.toFixed(1)} out of 5 stars`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} className={`h-4 w-4 ${i <= Math.round(avgRating) ? 'fill-amber-300 text-amber-300' : 'text-white/30'}`} aria-hidden />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Total reviews */}
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total reviews</p>
              <span className="rounded-full bg-indigo-50 p-2 text-indigo-600"><MessageSquare className="h-4 w-4" aria-hidden /></span>
            </div>
            <p className="mt-2 text-3xl font-bold leading-none text-foreground">{totalReviews}</p>
            <p className="mt-2 text-xs text-muted-foreground">{stats.week} new in the last 7 days</p>
          </CardContent>
        </Card>

        {/* Pending replies — action card */}
        <Card
          className={`rounded-2xl border-0 shadow-lg transition-all duration-200 hover:shadow-xl ${
            stats.pending > 0 ? 'bg-amber-50 shadow-amber-200/60 hover:shadow-amber-300/50' : 'shadow-slate-200/50 hover:shadow-emerald-500/10'
          }`}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-2">
              <p className={`text-xs font-semibold uppercase tracking-wider ${stats.pending > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                Pending replies
              </p>
              <span className={`rounded-full p-2 ${stats.pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-600'}`}>
                {stats.pending > 0 ? <Clock3 className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              </span>
            </div>
            <p className={`mt-2 text-3xl font-bold leading-none ${stats.pending > 0 ? 'text-amber-900' : 'text-foreground'}`}>{stats.pending}</p>
            <p className={`mt-2 text-xs ${stats.pending > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
              {stats.pending > 0 ? 'Waiting on a reply from your team' : `All caught up · ${stats.replied} replied`}
            </p>
          </CardContent>
        </Card>

        {/* Flagged */}
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Flagged by AI</p>
              <span className={`rounded-full p-2 ${stats.fakes > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                <ShieldAlert className="h-4 w-4" aria-hidden />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold leading-none text-foreground">{stats.fakes}</p>
            <p className="mt-2 text-xs text-muted-foreground">Suspected fake or spam reviews</p>
          </CardContent>
        </Card>
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
          variant="outline"
          size="sm"
          onClick={() => syncReplies.mutate()}
          disabled={syncReplies.isPending}
          className="cursor-pointer"
          aria-label="Sync replies already posted on Google"
        >
          <CheckCircle2 className={`h-4 w-4 mr-1.5 ${syncReplies.isPending ? 'animate-pulse' : ''}`} />
          Sync replies
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
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-36 rounded" />
                    <Skeleton className="h-3 w-24 rounded" />
                  </div>
                </div>
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-10 w-40 rounded-xl" />
              </CardContent>
            </Card>
          ))}
        </div>
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
            // Precedence: local edits → saved staff draft → sent text → AI draft.
            // Blank saved values must never mask a usable AI draft.
            const firstFilled = (...v: (string | null | undefined)[]) =>
              v.find((x) => typeof x === 'string' && x.trim().length > 0) ?? '';
            const draftValue = drafts[r.id] ?? firstFilled(r.draft_reply, r.reply_text, r.ai_draft_reply);
            const isDrafting = draftingId === r.id && draftWithAI.isPending;
            const Icon = cb.icon;
            return (
              <Card key={r.id} className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-600"
                        aria-hidden
                      >
                        {initialsOf(r.author_name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{r.author_name ?? 'Anonymous'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <StarRow rating={r.rating ?? 0} />
                          <span className="text-xs text-muted-foreground">
                            {r.relative_time ?? (r.posted_at ? format(new Date(r.posted_at), 'dd MMM yyyy, HH:mm') : '—')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.reply_status === 'sent' ? (
                        <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />Replied
                        </Badge>
                      ) : r.reply_status === 'dismissed' ? (
                        <Badge className={rb.cls}>{rb.label}</Badge>
                      ) : (
                        <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          <Clock3 className="mr-1 h-3 w-3" aria-hidden />Needs reply
                        </Badge>
                      )}
                      <Badge className={cb.cls}><Icon className="h-3 w-3 mr-1" />{cb.label}</Badge>
                      {r.source === 'places' && (
                        <Badge className="bg-slate-100 text-slate-600">Places · read-only</Badge>
                      )}
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

                  {/* Reply CTA */}
                  {r.reply_status !== 'sent' && r.reply_status !== 'dismissed' && !openReply[r.id] && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        className="h-11 cursor-pointer rounded-xl"
                        onClick={() => setOpenReply((o) => ({ ...o, [r.id]: true }))}
                      >
                        <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />
                        Reply to customer
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 cursor-pointer rounded-xl"
                        onClick={() => markReplied.mutate({ id: r.id, text: (r.google_reply_text ?? r.reply_text ?? '').trim() })}
                        disabled={markReplied.isPending}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
                        Already replied on Google
                      </Button>
                    </div>
                  )}

                  {/* Reply box */}
                  {r.reply_status !== 'sent' && r.reply_status !== 'dismissed' && openReply[r.id] && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Draft reply (editable)</p>
                        <div className="flex items-center gap-2">
                          <Select
                            onValueChange={(tone) => draftWithAI.mutate({ id: r.id, tone })}
                            disabled={isDrafting}
                          >
                            <SelectTrigger className="h-8 w-[150px] rounded-lg text-xs" aria-label="Adjust the AI reply tone">
                              <SelectValue placeholder="Adjust tone" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="warm">Warm</SelectItem>
                              <SelectItem value="short">Short</SelectItem>
                              <SelectItem value="apologetic">Apologetic</SelectItem>
                              <SelectItem value="professional">Professional</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => draftWithAI.mutate({ id: r.id })}
                            disabled={isDrafting}
                          >
                            {isDrafting
                              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />
                              : <Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden />}
                            {draftValue.trim() ? 'Regenerate with AI' : 'Draft reply with AI'}
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        value={draftValue}
                        onChange={(e) => setDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                        onBlur={() => {
                          // Never persist an empty box over a stored draft.
                          if (draftValue.trim()) saveDraft.mutate({ id: r.id, draft: draftValue });
                        }}
                        rows={3}
                        className="rounded-xl"
                        aria-label={`Reply to the review by ${r.author_name ?? 'Anonymous'}`}
                        placeholder="Write a reply, or click Draft reply with AI"
                      />
                      <p className="text-xs text-muted-foreground">
                        {draftValue.length}/4000 characters · drafts save automatically
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {canReply ? (
                          <Button
                            size="sm"
                            onClick={() => sendReply.mutate({ id: r.id, text: draftValue })}
                            disabled={!draftValue.trim() || (sendReply.isPending && replyingId === r.id)}
                          >
                            {sendReply.isPending && replyingId === r.id
                              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />
                              : <Send className="h-3.5 w-3.5 mr-1.5" aria-hidden />}
                            Post reply
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              disabled={!draftValue.trim()}
                              onClick={async () => {
                                const ok = await copyToClipboard(draftValue);
                                saveDraft.mutate({ id: r.id, draft: draftValue });
                                toast[ok ? 'success' : 'error'](
                                  ok ? 'Reply copied — paste it on Google' : 'Could not copy the reply',
                                );
                                const url = r.review_permalink ?? placeUri;
                                if (url) window.open(url, '_blank', 'noopener,noreferrer');
                              }}
                              title="Copies your reply and opens this review on Google so you can paste it there"
                            >
                              <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                              Copy &amp; open on Google
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => markReplied.mutate({ id: r.id, text: draftValue })}
                              disabled={markReplied.isPending}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                              Mark as replied on Google
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="outline" onClick={() => reclassify.mutate(r.id)} disabled={reclassify.isPending}>
                          <Sparkles className="h-3.5 w-3.5 mr-1.5" />Re-analyse with AI
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateRow.mutate({ id: r.id, patch: { reply_status: 'reported', reported_to_google_at: new Date().toISOString() } })}>
                          <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />Mark as reported
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => updateRow.mutate({ id: r.id, patch: { reply_status: 'dismissed' } })}>
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="cursor-pointer"
                          onClick={() => setOpenReply((o) => ({ ...o, [r.id]: false }))}
                        >
                          Cancel
                        </Button>
                      </div>
                      {!canReply && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Google has not granted this project reply-posting access yet, so replies are posted by hand:
                          copy the draft, paste it on Google, then mark it replied here to clear the queue.
                        </p>
                      )}
                    </div>
                  )}

                  {r.reply_status === 'sent' && (r.google_reply_text || r.reply_text) && (
                    <div className="rounded-xl bg-success/10 p-3 text-sm">
                      <p className="text-xs font-semibold text-success uppercase tracking-wider mb-1 flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        {r.reply_mode === 'manual_google'
                          ? 'Replied manually on Google'
                          : r.reply_mode === 'google_owner'
                            ? 'Replied on Google'
                            : 'Replied from Incline'}
                        {r.replied_at ? ` · ${format(new Date(r.replied_at), "dd MMM yyyy, h:mm a")}` : ''}
                      </p>
                      <p className="text-foreground whitespace-pre-wrap">{r.google_reply_text ?? r.reply_text}</p>
                    </div>
                  )}

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <GoogleBusinessDrawer
        open={connectOpen}
        onOpenChange={(o) => {
          setConnectOpen(o);
          if (!o) { recheckConn(); qc.invalidateQueries({ queryKey: ['gri-integration', branchId] }); }
        }}
        branchId={branchId}
        branchName={branchName}
      />
    </div>
  );
}
