import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Star, MessageSquare, CheckCircle, Clock, Eye, Globe, Download,
  Send, AlertTriangle, MailQuestion, ThumbsUp, Reply,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { exportToCSV } from '@/lib/csvExport';
import ExternalReviewsTab from '@/components/feedback/ExternalReviewsTab';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { LivePill } from '@/components/ui/live-pill';

type RequestStatus = 'not_sent' | 'queued' | 'sent' | 'delivered' | 'failed';

const REQUEST_STATUS_BADGE: Record<RequestStatus, { label: string; cls: string }> = {
  not_sent: { label: 'Not sent', cls: 'bg-muted text-muted-foreground' },
  queued:   { label: 'Queued',   cls: 'bg-warning/15 text-warning' },
  sent:     { label: 'Sent',     cls: 'bg-info/15 text-info' },
  delivered:{ label: 'Delivered',cls: 'bg-success/15 text-success' },
  failed:   { label: 'Failed',   cls: 'bg-destructive/15 text-destructive' },
};

export default function FeedbackPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [requestFilter, setRequestFilter] = useState<string>('all'); // all | sent | not_sent
  const [reviewFilter, setReviewFilter] = useState<string>('all');   // all | received | none
  const [unresolvedLow, setUnresolvedLow] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const { effectiveBranchId: branchId = '' } = useBranchContext();

  useRealtimeInvalidate({
    channel: 'page-feedback',
    tables: ['feedback'],
    invalidateKeys: [['feedback']],
  });

  const { data: feedbackList = [], isLoading } = useQuery({
    queryKey: ['feedback', branchId, statusFilter, ratingFilter, requestFilter, reviewFilter, unresolvedLow],
    queryFn: async () => {
      if (!branchId) return [];
      let query = supabase
        .from('feedback')
        .select(`
          *,
          members(member_code, user_id),
          employees(user_id),
          trainers(user_id)
        `)
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (ratingFilter !== 'all') query = query.eq('rating', Number(ratingFilter));
      if (requestFilter === 'sent') query = query.in('google_review_request_status', ['sent', 'delivered']);
      if (requestFilter === 'not_sent') query = query.in('google_review_request_status', ['not_sent', 'queued', 'failed']);
      if (reviewFilter === 'received') query = query.not('google_review_id', 'is', null);
      if (reviewFilter === 'none') query = query.is('google_review_id', null);
      if (unresolvedLow) query = query.lte('rating', 3).neq('status', 'resolved');

      const { data, error } = await query;
      if (error) throw error;

      const userIds = new Set<string>();
      (data || []).forEach((f: any) => {
        if (f.members?.user_id) userIds.add(f.members.user_id);
        if (f.employees?.user_id) userIds.add(f.employees.user_id);
        if (f.trainers?.user_id) userIds.add(f.trainers.user_id);
      });

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(userIds));

      const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));

      return (data || []).map((f: any) => ({
        ...f,
        member_name:   f.members?.user_id   ? profileMap.get(f.members.user_id)   : null,
        trainer_name:  f.trainers?.user_id  ? profileMap.get(f.trainers.user_id)  : null,
        employee_name: f.employees?.user_id ? profileMap.get(f.employees.user_id) : null,
      }));
    },
    enabled: !!branchId,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, isApprovedForGoogle }: { id: string; status?: string; isApprovedForGoogle?: boolean }) => {
      const updates: any = {};
      if (status !== undefined) updates.status = status;
      if (isApprovedForGoogle !== undefined) updates.is_approved_for_google = isApprovedForGoogle;
      const { error } = await supabase.from('feedback').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feedback updated');
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
    onError: () => toast.error('Failed to update feedback'),
  });

  const requestReview = useMutation({
    mutationFn: async (feedbackId: string) => {
      const { data, error } = await supabase.functions.invoke('request-google-review', {
        body: { feedback_id: feedbackId },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || 'Request failed');
      return data;
    },
    onSuccess: () => {
      toast.success('Google review request sent');
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to send review request'),
  });

  // Dashboard stats — last 30d window for "trend" cards, all-time for cases
  const stats = useMemo(() => {
    const cutoff = subDays(new Date(), 30).getTime();
    const recent = feedbackList.filter((f: any) => new Date(f.created_at).getTime() >= cutoff);

    const avgRating = recent.length
      ? (recent.reduce((s: number, f: any) => s + (f.rating || 0), 0) / recent.length).toFixed(1)
      : '0';

    const lowOpen = feedbackList.filter((f: any) => (f.rating ?? 5) <= 3 && f.status !== 'resolved').length;

    const requestsSent = recent.filter((f: any) => ['sent', 'delivered'].includes(f.google_review_request_status)).length;
    const reviewsReceived = recent.filter((f: any) => !!f.google_review_id).length;
    const conversion = requestsSent > 0 ? Math.round((reviewsReceived / requestsSent) * 100) : 0;

    return { avgRating, lowOpen, requestsSent, reviewsReceived, conversion };
  }, [feedbackList]);

  const ratingColor = (r: number) => r >= 4 ? 'text-success' : r >= 3 ? 'text-warning' : 'text-destructive';

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending':  return <Badge className="bg-warning/15 text-warning"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'reviewed': return <Badge className="bg-info/15 text-info"><Eye className="w-3 h-3 mr-1" />Reviewed</Badge>;
      case 'resolved': return <Badge className="bg-success/15 text-success"><CheckCircle className="w-3 h-3 mr-1" />Resolved</Badge>;
      default:         return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const requestBadge = (s: string | null | undefined) => {
    const meta = REQUEST_STATUS_BADGE[(s as RequestStatus) || 'not_sent'];
    return <Badge className={meta.cls}>{meta.label}</Badge>;
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Feedback & Reviews</h1>
              <LivePill />
            </div>
            <p className="text-muted-foreground">Member feedback in-app, plus inbound Google reviews with AI triage.</p>
          </div>
        </div>

        <Tabs defaultValue="member" className="w-full">
          <TabsList>
            <TabsTrigger value="member">Member Feedback</TabsTrigger>
            <TabsTrigger value="external">External Reviews</TabsTrigger>
          </TabsList>

          <TabsContent value="member" className="space-y-6 mt-6">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                const rows = feedbackList.map((f: any) => ({
                  Member: f.member_name || 'Unknown',
                  Rating: f.rating,
                  Feedback: f.feedback_text || '',
                  Category: f.category || '',
                  Status: f.status || '',
                  ReviewRequest: f.google_review_request_status || 'not_sent',
                  GoogleReviewId: f.google_review_id || '',
                  Date: f.created_at ? format(new Date(f.created_at), 'yyyy-MM-dd') : '',
                }));
                exportToCSV(rows, 'feedback');
              }}>
                <Download className="h-4 w-4" /> Export
              </Button>
            </div>

        {/* Dashboard cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          <StatCard title="Avg Rating (30d)" value={stats.avgRating} icon={Star}
            variant={Number(stats.avgRating) >= 4 ? 'success' : Number(stats.avgRating) >= 3 ? 'warning' : 'destructive'} />
          <StatCard title="Low-rating open cases" value={stats.lowOpen} icon={AlertTriangle}
            variant={stats.lowOpen > 0 ? 'destructive' : 'default'} />
          <StatCard title="Review requests (30d)" value={stats.requestsSent} icon={Send} />
          <StatCard title="Google reviews (30d)" value={stats.reviewsReceived} icon={ThumbsUp} variant="success" />
          <StatCard title="Request → Review %" value={`${stats.conversion}%`} icon={MailQuestion} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Rating" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ratings</SelectItem>
              {[5,4,3,2,1].map(n => <SelectItem key={n} value={String(n)}>{n} ★</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={requestFilter} onValueChange={setRequestFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Google request" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requests</SelectItem>
              <SelectItem value="sent">Request sent</SelectItem>
              <SelectItem value="not_sent">Not sent / failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={reviewFilter} onValueChange={setReviewFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Google review" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="received">Review received</SelectItem>
              <SelectItem value="none">No review yet</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={unresolvedLow ? 'default' : 'outline'} size="sm" onClick={() => setUnresolvedLow(v => !v)}>
            <AlertTriangle className="h-4 w-4 mr-1.5" />
            Unresolved low ratings
          </Button>
        </div>

        {/* Feedback Table */}
        <Card className="rounded-2xl shadow-lg shadow/50">
          <CardHeader><CardTitle>All Feedback</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Feedback</TableHead>
                      <TableHead>Related To</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Review Request</TableHead>
                      <TableHead>Google Review</TableHead>
                      <TableHead>Testimonial</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedbackList.map((f: any) => (
                      <TableRow key={f.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{f.member_name || 'Unknown'}</p>
                            <p className="text-xs text-muted-foreground">{f.members?.member_code}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`flex items-center gap-1 ${ratingColor(f.rating)}`}>
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} className={`h-4 w-4 ${i < f.rating ? 'fill-current' : 'text-muted'}`} />
                            ))}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{f.category}</Badge></TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="text-sm truncate">{f.feedback_text || '-'}</p>
                        </TableCell>
                        <TableCell>
                          {f.trainer_name && <p className="text-xs">Trainer: {f.trainer_name}</p>}
                          {f.employee_name && <p className="text-xs">Staff: {f.employee_name}</p>}
                          {!f.trainer_name && !f.employee_name && '-'}
                          {f.recovery_task_id && (
                            <Badge className="mt-1 bg-destructive/10 text-destructive text-[10px]">Recovery task</Badge>
                          )}
                        </TableCell>
                        <TableCell>{statusBadge(f.status)}</TableCell>
                        <TableCell>
                          {f.rating >= 4 ? (
                            <div className="flex items-center gap-2">
                              {requestBadge(f.google_review_request_status)}
                              <Button
                                size="sm" variant="outline" className="h-7 px-2"
                                onClick={() => requestReview.mutate(f.id)}
                                disabled={requestReview.isPending}
                              >
                                <Send className="h-3 w-3 mr-1" />
                                {f.google_review_request_status === 'sent' || f.google_review_request_status === 'delivered'
                                  ? 'Resend' : 'Send'}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">N/A (low rating)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {f.google_review_id ? (
                            <Badge className="bg-success/15 text-success gap-1">
                              <Globe className="h-3 w-3" />Received
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={f.is_approved_for_google || false}
                              disabled={!f.consent_for_testimonial}
                              onCheckedChange={(checked) =>
                                updateStatus.mutate({ id: f.id, isApprovedForGoogle: checked })
                              }
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {f.consent_for_testimonial ? 'Use' : 'No consent'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(f.created_at), 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell>
                          <Select value={f.status} onValueChange={(s) => updateStatus.mutate({ id: f.id, status: s })}>
                            <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="reviewed">Reviewed</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                    {feedbackList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          No feedback matches your filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="external" className="mt-6">
            <ExternalReviewsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
