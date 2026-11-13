import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ApprovalTrendChart } from '@/components/approvals/ApprovalTrendChart';
import { usePageEntrance, useRowsEntrance, useCountUp, prefersReducedMotion } from '@/components/approvals/approvalMotion';
import { clickOnActivateKey } from '@/lib/a11y/clickable';
import gsap from 'gsap';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { ApproveLockerRequestSheet, type LockerRequestRow } from '@/components/lockers/ApproveLockerRequestSheet';
import { closeMemberRequestTask } from '@/lib/tasks/memberRequestTasks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, formatDistanceToNowStrict, subDays } from 'date-fns';

const safeFormatDate = (value: any, fmt: string = 'dd MMM yyyy', fallback: string = '-') => {
  if (!value) return fallback;
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return fallback;
    return format(date, fmt);
  } catch {
    return fallback;
  }
};
import {
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Pause,
  Calendar,
  CreditCard,
  Percent,
  Gift,
  FileText,
  DollarSign,
  ArrowLeftRight,
  CheckCircle2,
  User,
} from 'lucide-react';

import { Building2 } from 'lucide-react';

const APPROVAL_TYPE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  membership_freeze: { icon: Pause, label: 'Freeze', color: 'bg-info/10 text-info' },
  membership_transfer: { icon: ArrowLeftRight, label: 'Membership Transfer', color: 'bg-primary/10 text-primary' },
  branch_transfer: { icon: Building2, label: 'Branch Transfer', color: 'bg-primary/10 text-primary' },
  refund: { icon: DollarSign, label: 'Refund', color: 'bg-destructive/10 text-destructive' },
  discount: { icon: Percent, label: 'Discount', color: 'bg-warning/10 text-warning' },
  complimentary: { icon: Gift, label: 'Complimentary', color: 'bg-success/10 text-success' },
  comp_gift: { icon: Gift, label: 'Comp/Gift', color: 'bg-warning/10 text-warning' },
  expense: { icon: CreditCard, label: 'Expense', color: 'bg-muted text-muted-foreground' },
  contract: { icon: FileText, label: 'Contract', color: 'bg-accent/10 text-accent' },
  trainer_change: { icon: User, label: 'Trainer Change', color: 'bg-primary/10 text-primary' },
  pt_attendance_correction: { icon: Clock, label: 'PT Attendance Correction', color: 'bg-warning/10 text-warning' },
  referral_reward: { icon: Clock, label: 'Referral Reward', color: 'bg-accent/10 text-accent' },
};

export default function ApprovalQueuePage() {
  const { user } = useAuth();
  const { branchFilter, selectedBranch, setSelectedBranch, branches } = useBranchContext();
  const [activeTab, setActiveTab] = useState('pending');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [lockerApproval, setLockerApproval] = useState<LockerRequestRow | null>(null);
  const queryClient = useQueryClient();

  // Fetch approval requests
  const { data: requests = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['approval-queue', branchFilter, activeTab],
    queryFn: async () => {
      let query = supabase
        .from('approval_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (branchFilter) {
        query = query.eq('branch_id', branchFilter);
      }

      if (activeTab !== 'all') {
        query = query.eq('status', activeTab as 'pending' | 'approved' | 'rejected');
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data;
    },
  });

  // Stats queries
  const { data: stats } = useQuery({
    queryKey: ['approval-stats', branchFilter],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      
      let pendingQuery = supabase.from('approval_requests').select('id', { count: 'exact' }).eq('status', 'pending');
      let approvedQuery = supabase.from('approval_requests').select('id', { count: 'exact' }).eq('status', 'approved').gte('reviewed_at', today);
      let rejectedQuery = supabase.from('approval_requests').select('id', { count: 'exact' }).eq('status', 'rejected').gte('reviewed_at', today);

      if (branchFilter) {
        pendingQuery = pendingQuery.eq('branch_id', branchFilter);
        approvedQuery = approvedQuery.eq('branch_id', branchFilter);
        rejectedQuery = rejectedQuery.eq('branch_id', branchFilter);
      }

      const [{ count: pending }, { count: approved }, { count: rejected }] = await Promise.all([
        pendingQuery,
        approvedQuery,
        rejectedQuery,
      ]);

      return { pending: pending || 0, approvedToday: approved || 0, rejectedToday: rejected || 0 };
    },
  });

  const { data: decisions = [] } = useQuery({
    queryKey: ['approval-stats', 'trend', branchFilter],
    queryFn: async () => {
      let q = supabase.from('approval_requests').select('status, reviewed_at')
        .in('status', ['approved', 'rejected']).gte('reviewed_at', format(subDays(new Date(), 6), 'yyyy-MM-dd'));
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      return data as { status: string; reviewed_at: string | null }[];
    },
  });

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`approval-queue-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
        queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Process approval mutation — single authoritative RPC call.
  // The backend locks the request, runs the side-effect, and only then
  // marks it approved. On failure the request stays pending and the real
  // error is surfaced to the operator.
  const approveMutation = useMutation({
    mutationFn: async ({ requestId, approved }: { requestId: string; approved: boolean }) => {
      const request = requests.find((r) => r.id === requestId);
      if ((request as any)?.approval_type === 'referral_reward') {
        const { data: rr, error: rrErr } = await supabase.rpc('decide_referral_reward_claim', {
          p_approval_id: requestId,
          p_decision: approved ? 'approve' : 'reject',
          p_note: reviewNotes[requestId] || null,
        });
        if (rrErr) throw rrErr;
        const r = rr as { success?: boolean; error?: string } | null;
        if (!r?.success) throw new Error(r?.error || 'Failed to decide reward');
        queryClient.invalidateQueries({ queryKey: ['referral-rewards'] });
        return { approved };
      }
      if ((request as any)?.approval_type === 'pt_attendance_correction') {
        const { error: corrErr } = await supabase.rpc('pt_attendance_decide_correction', {
          p_correction_id: (request as any).reference_id,
          p_decision: approved ? 'approve' : 'reject',
          p_note: reviewNotes[requestId] || null,
        });
        if (corrErr) throw corrErr;
        queryClient.invalidateQueries({ queryKey: ['pt-auto-attendance'] });
        return { approved };
      }
      const { data, error } = await supabase.rpc('process_approval_request', {
        p_request_id: requestId,
        p_decision: approved ? 'approve' : 'reject',
        p_review_notes: reviewNotes[requestId] || null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string; status?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Failed to process approval');

      // Close the staff task raised by the member's portal request.
      await closeMemberRequestTask({
        memberId: (request as any)?.reference_id,
        referenceType: (request as any)?.reference_type,
        decision: approved ? 'approved' : 'rejected',
      });
      return { approved };
    },
    onSuccess: (data) => {
      toast.success(data.approved ? 'Request approved' : 'Request rejected');
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['memberships'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-stats'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to process request');
    },
  });

  const getTypeConfig = (type: string) => {
    return APPROVAL_TYPE_CONFIG[type] || { icon: Calendar, label: type.replace('_', ' '), color: 'bg-muted text-muted-foreground' };
  };

  const renderRequestDetails = (request: any) => {
    const data = request.request_data as any;

    if (request.approval_type === 'membership_freeze') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data.memberName}</p>
          <p><span className="text-muted-foreground">Duration:</span> {data.daysFrozen} days</p>
          <p><span className="text-muted-foreground">Period:</span> {safeFormatDate(data.startDate, 'dd MMM', 'Pending')} - {safeFormatDate(data.endDate, 'dd MMM yyyy', 'Pending')}</p>
          {data.reason && <p><span className="text-muted-foreground">Reason:</span> {data.reason}</p>}
        </div>
      );
    }

    if (request.approval_type === 'referral_reward') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data.memberName} {data.memberCode ? `(${data.memberCode})` : ''}</p>
          <p><span className="text-muted-foreground">Reward:</span> ₹{Number(data.rewardValue || 0).toLocaleString('en-IN')} to wallet</p>
          {data.description && <p><span className="text-muted-foreground">For:</span> {data.description}</p>}
        </div>
      );
    }

    if (request.approval_type === 'pt_attendance_correction') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data.memberName}</p>
          <p><span className="text-muted-foreground">Trainer:</span> {data.trainerName}</p>
          <p><span className="text-muted-foreground">Request:</span> {data.action === 'mark' ? 'Mark PT session' : 'Undo PT session'} on {safeFormatDate(data.sessionDate, 'dd MMM yyyy')}</p>
          <p><span className="text-muted-foreground">Client in / Trainer in:</span> {safeFormatDate(data.memberIn, 'HH:mm')} / {safeFormatDate(data.trainerIn, 'HH:mm')}</p>
          {data.reason && <p><span className="text-muted-foreground">Reason:</span> {data.reason}</p>}
        </div>
      );
    }

    if (request.reference_type === 'trainer_change') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data.memberName || 'N/A'} {data.memberCode ? `(${data.memberCode})` : ''}</p>
          <p><span className="text-muted-foreground">Current Trainer:</span> {data.current_trainer_name || data.currentTrainerName || (data.request_mode === 'new' ? 'None — wants a trainer' : 'Not recorded')}
            {data.current_trainer_source && <span className="text-muted-foreground"> · {data.current_trainer_source === 'general' ? 'General coach' : 'Personal training'}</span>}</p>
          {data.reason_label && (
            <p><span className="text-muted-foreground">Reason:</span>{' '}
              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${['guidance','communication'].includes(data.reason_code) ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-muted text-muted-foreground border-border'}`}>{data.reason_label}</span>
            </p>
          )}
          {data.goal && <p><span className="text-muted-foreground">Goal:</span> {data.goal}</p>}
          {data.preferred_slot && <p><span className="text-muted-foreground">Preferred time:</span> {data.preferred_slot}</p>}
          {(data.preferred_trainer_name || data.newTrainerName) && <p><span className="text-muted-foreground">Preferred trainer:</span> {data.preferred_trainer_name || data.newTrainerName}</p>}
          {data.reason && <p><span className="text-muted-foreground">{data.reason_label ? 'Details' : 'Reason'}:</span> {data.reason}</p>}
        </div>
      );
    }

    if (request.reference_type === 'locker') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data?.memberName || 'N/A'} {data?.memberCode ? `(${data.memberCode})` : ''}</p>
          <p><span className="text-muted-foreground">Type:</span> Locker allocation request</p>
          {data?.preferred_size && <p><span className="text-muted-foreground">Size:</span> {data.preferred_size}{data?.quoted_fee?.total != null ? ` · quoted ₹${Number(data.quoted_fee.total).toLocaleString('en-IN')}${Number(data.quoted_fee.gst) > 0 ? ' incl. GST' : ' · no GST'}` : ''}</p>}
          {data?.assigned_locker && <p><span className="text-muted-foreground">Assigned:</span> {data.assigned_locker} · billed ₹{Number(data.charged_fee || 0).toLocaleString('en-IN')} + GST</p>}
          {data?.note && <p><span className="text-muted-foreground">Preference:</span> {data.note}</p>}
        </div>
      );
    }

    if (request.approval_type === 'comp_gift') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data.memberName}</p>
          {request.reference_type === 'extend_days' ? (
            <>
              <p><span className="text-muted-foreground">Type:</span> Extend Days (+{data.days})</p>
              <p><span className="text-muted-foreground">New Expiry:</span> {safeFormatDate(data.newEndDate, 'dd MMM yyyy', 'N/A')}</p>
            </>
          ) : (
            <>
              <p><span className="text-muted-foreground">Type:</span> Comp Sessions ({data.sessions}x)</p>
              <p><span className="text-muted-foreground">Benefit:</span> {data.benefitTypeName}</p>
            </>
          )}
          {data.reason && <p><span className="text-muted-foreground">Reason:</span> {data.reason}</p>}
        </div>
      );
    }

    if (request.approval_type === 'membership_transfer') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">From:</span> {data.from_member_name}</p>
          <p><span className="text-muted-foreground">To:</span> {data.to_member_name} {data.to_member_code ? `(${data.to_member_code})` : ''}</p>
          {data.is_chargeable && <p><span className="text-muted-foreground">Fee:</span> ₹{data.transfer_fee}</p>}
          {data.reason && <p><span className="text-muted-foreground">Reason:</span> {data.reason}</p>}
        </div>
      );
    }

    if (request.approval_type === 'branch_transfer') {
      return (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Member:</span> {data.memberName}</p>
          <p><span className="text-muted-foreground">From:</span> {data.from_branch_name}</p>
          <p><span className="text-muted-foreground">To:</span> {data.to_branch_name}</p>
          {data.reason && <p><span className="text-muted-foreground">Reason:</span> {data.reason}</p>}
        </div>
      );
    }

    return (
      <div className="text-sm">
        {data?.memberName && <p><span className="text-muted-foreground">Member:</span> {data.memberName}</p>}
        {data?.amount && <p><span className="text-muted-foreground">Amount:</span> ₹{data.amount}</p>}
        {data?.reason && <p><span className="text-muted-foreground">Reason:</span> {data.reason}</p>}
      </div>
    );
  };

  // ---------- Derived list (search + type chips are client-side) ----------
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const timers = useRef<Map<string, number>>(new Map());
  const pageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  usePageEntrance(pageRef);

  const searched = useMemo(() => requests.filter((r) => {
    if (hidden.has(r.id)) return false;
    if (!search) return true;
    const d = r.request_data as any;
    const q = search.toLowerCase();
    return d?.memberName?.toLowerCase().includes(q) || d?.memberCode?.toLowerCase().includes(q) || r.approval_type?.toLowerCase().includes(q);
  }), [requests, hidden, search]);
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    searched.forEach((r) => m.set(r.approval_type, (m.get(r.approval_type) || 0) + 1));
    return m;
  }, [searched]);
  const filteredRequests = useMemo(() => typeFilter === 'all' ? searched : searched.filter((r) => r.approval_type === typeFilter), [searched, typeFilter]);
  const selected = filteredRequests.find((r) => r.id === selectedId) || null;

  useRowsEntrance(listRef, `${activeTab}|${typeFilter}|${branchFilter}|${isLoading}`);

  // Keep a selection on desktop
  useEffect(() => {
    if (!selected && filteredRequests.length && window.matchMedia('(min-width: 1024px)').matches) setSelectedId(filteredRequests[0].id);
  }, [selected, filteredRequests]);
  useEffect(() => { setRejectMode(false); }, [selectedId]);

  // Detail panel entrance on selection change
  useEffect(() => {
    if (!panelRef.current || !selectedId || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-anim="detail"]', { opacity: 0, y: 14, duration: 0.5, ease: 'power3.out', stagger: 0.04, clearProps: 'opacity,transform' });
    }, panelRef);
    return () => ctx.revert();
  }, [selectedId]);

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  const oldestPending = useMemo(() => {
    const p = requests.filter((r) => r.status === 'pending');
    if (!p.length) return null;
    return p.reduce((a, b) => (a.created_at < b.created_at ? a : b)).created_at;
  }, [requests]);

  const selectNext = useCallback((fromId: string) => {
    const i = filteredRequests.findIndex((r) => r.id === fromId);
    const next = filteredRequests[i + 1] || filteredRequests[i - 1];
    setSelectedId(next && next.id !== fromId ? next.id : null);
    if (!next) setMobileOpen(false);
  }, [filteredRequests]);

  const decide = useCallback((request: any, approved: boolean) => {
    if (approved && request.approval_type === 'locker_request') {
      setLockerApproval(request as unknown as LockerRequestRow);
      return;
    }
    if (!approved && !(reviewNotes[request.id] || '').trim()) {
      setRejectMode(true);
      toast.error('Add a short reason before rejecting');
      return;
    }
    const run = () => {
      setHidden((h) => { const n = new Set(h); n.add(request.id); return n; });
      selectNext(request.id);
      const t = window.setTimeout(() => {
        timers.current.delete(request.id);
        approveMutation.mutate({ requestId: request.id, approved }, {
          onSettled: () => setHidden((h) => { const n = new Set(h); n.delete(request.id); return n; }),
        });
      }, 5000);
      timers.current.set(request.id, t);
      toast(approved ? 'Approving request…' : 'Rejecting request…', {
        duration: 5000,
        action: { label: 'Undo', onClick: () => {
          const tm = timers.current.get(request.id);
          if (tm) { window.clearTimeout(tm); timers.current.delete(request.id); }
          setHidden((h) => { const n = new Set(h); n.delete(request.id); return n; });
          setSelectedId(request.id);
        } },
      });
    };
    const row = listRef.current?.querySelector(`[data-row-id="${request.id}"]`);
    if (row && !prefersReducedMotion()) gsap.to(row, { opacity: 0, y: 8, scale: 0.985, duration: 0.18, ease: 'power2.in', onComplete: run });
    else run();
  }, [reviewNotes, selectNext, approveMutation]);

  // Keyboard: J/K move, A approve, R reject
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') && !mobileOpen) return;
      if (t.closest('input, textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = filteredRequests.findIndex((r) => r.id === selectedId);
      if (e.key === 'j' || e.key === 'k') {
        const n = filteredRequests[Math.max(0, Math.min(filteredRequests.length - 1, i + (e.key === 'j' ? 1 : -1)))];
        if (n) { setSelectedId(n.id); e.preventDefault(); }
      } else if (selected?.status === 'pending' && e.key === 'a') { decide(selected, true); e.preventDefault(); }
      else if (selected?.status === 'pending' && e.key === 'r') { setRejectMode(true); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredRequests, selectedId, selected, decide, mobileOpen]);

  const initials = (name?: string) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const memberOf = (r: any) => { const d = r.request_data as any; return d?.memberName || d?.from_member_name || 'Request'; };
  const waited = (iso: string) => { try { return formatDistanceToNowStrict(new Date(iso), { addSuffix: false }); } catch { return ''; } };
  const urgency = (r: any) => {
    if (r.status !== 'pending') return 'bg-muted-foreground/40';
    const h = (Date.now() - new Date(r.created_at).getTime()) / 36e5;
    return h > 48 ? 'bg-destructive' : h > 12 ? 'bg-warning' : 'bg-success';
  };
  const statusClass = (s: string) => s === 'pending' ? 'bg-warning/10 text-warning border-warning/20' : s === 'approved' ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20';

  const title = 'Approval Queue';
  const statCards = [
    { key: 'pending', label: 'Pending', value: stats?.pending || 0, icon: Clock, tone: 'text-warning bg-warning/10', tab: 'pending' },
    { key: 'approved', label: 'Approved today', value: stats?.approvedToday || 0, icon: CheckCircle2, tone: 'text-success bg-success/10', tab: 'approved' },
    { key: 'rejected', label: 'Rejected today', value: stats?.rejectedToday || 0, icon: XCircle, tone: 'text-destructive bg-destructive/10', tab: 'rejected' },
  ];

  const detailBody = (r: any) => {
    const config = getTypeConfig(r.approval_type);
    const TypeIcon = config.icon;
    return (
      <div className="flex h-full flex-col">
        <div className="space-y-4 flex-1 overflow-y-auto">
          <div data-anim="detail" className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-base font-bold text-primary">{initials(memberOf(r))}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{memberOf(r)}</p>
              <p className="text-xs text-muted-foreground">Raised {safeFormatDate(r.created_at, 'dd MMM yyyy, HH:mm')} · waited {waited(r.created_at)}</p>
            </div>
            <Badge variant="outline" className={`capitalize ${statusClass(r.status)}`}>{r.status}</Badge>
          </div>
          <div data-anim="detail"><Badge className={config.color}><TypeIcon className="h-3 w-3 mr-1" />{config.label}</Badge></div>
          <div data-anim="detail" className="rounded-2xl bg-muted/50 p-4">{renderRequestDetails(r)}</div>
          {r.review_notes && r.status !== 'pending' && (
            <p data-anim="detail" className="rounded-2xl bg-muted/50 p-4 text-sm"><span className="font-semibold">Notes:</span> {r.review_notes}</p>
          )}
          {r.status === 'pending' && (
            <div data-anim="detail" className="space-y-1.5">
              <label htmlFor={`note-${r.id}`} className="text-sm font-semibold">{rejectMode ? 'Reason for rejecting (required)' : 'Notes (optional)'}</label>
              <Textarea id={`note-${r.id}`} value={reviewNotes[r.id] || ''} rows={3} autoFocus={rejectMode}
                placeholder={rejectMode ? 'Tell the team why this was rejected' : 'Add context for the record'}
                onChange={(e) => setReviewNotes({ ...reviewNotes, [r.id]: e.target.value })} />
            </div>
          )}
        </div>
        {r.status === 'pending' && (
          <div data-anim="detail" className="sticky bottom-0 mt-4 flex gap-2 bg-card pt-3">
            <Button variant="outline" className="flex-1 text-destructive hover:bg-destructive/10" disabled={approveMutation.isPending}
              onClick={() => (rejectMode ? decide(r, false) : setRejectMode(true))}>
              <XCircle className="h-4 w-4 mr-1" />{rejectMode ? 'Confirm reject' : 'Reject'}
            </Button>
            <Button className="flex-1" disabled={approveMutation.isPending} onClick={() => decide(r, true)}>
              <CheckCircle className="h-4 w-4 mr-1" />Approve
            </Button>
          </div>
        )}
      </div>
    );
  };

  const typeChips = ['all', ...Array.from(new Set([...Object.keys(APPROVAL_TYPE_CONFIG).filter((k) => typeCounts.has(k)), ...typeCounts.keys()]))];

  return (
    <AppLayout>
      <div ref={pageRef} className="space-y-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight" aria-label={title}>
            {title.split(' ').map((w, wi) => (
              <span key={wi} aria-hidden="true" className="mr-[0.25em] inline-block overflow-hidden align-bottom">
                {w.split('').map((c, ci) => <span key={ci} data-anim="char" className="inline-block">{c}</span>)}
              </span>
            ))}
          </h1>
          <p className="text-muted-foreground" aria-live="polite">
            {stats?.pending ? `${stats.pending} waiting${oldestPending && activeTab === 'pending' ? ` · oldest ${waited(oldestPending)}` : ''}` : 'Everything is reviewed'}
            <span className="hidden lg:inline"> · Shortcuts: J/K move, A approve, R reject</span>
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-3 gap-3 lg:col-span-7">
            {statCards.map((s) => <StatCard key={s.key} {...s} active={activeTab === s.tab} onClick={() => setActiveTab(s.tab)} />)}
          </div>
          <Card data-anim="card" className="lg:col-span-5 rounded-2xl">
            <CardHeader className="pb-1"><CardTitle className="text-base">Decisions · last 7 days</CardTitle></CardHeader>
            <CardContent><ApprovalTrendChart rows={decisions} /></CardContent>
          </Card>
        </div>

        <Card data-anim="card" className="rounded-2xl">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search requests" placeholder="Search by member name or code..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="rounded-full">
                  {['pending', 'approved', 'rejected', 'all'].map((t) => (
                    <TabsTrigger key={t} value={t} className="rounded-full capitalize gap-1.5">
                      {t}{t === 'pending' && stats?.pending ? <Badge variant="secondary" className="h-5 px-1.5">{stats.pending}</Badge> : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter by type">
              {typeChips.map((k) => {
                const active = typeFilter === k;
                const label = k === 'all' ? 'All types' : getTypeConfig(k).label;
                const count = k === 'all' ? searched.length : typeCounts.get(k) || 0;
                return (
                  <button key={k} type="button" aria-pressed={active} onClick={() => setTypeFilter(k)}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                    {label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-primary-foreground/20' : 'bg-background'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-12">
          <Card data-anim="card" className="rounded-2xl lg:col-span-5">
            <CardContent className="p-2" ref={listRef}>
              {isLoading ? (
                <div className="space-y-2 p-1" aria-busy="true" aria-label="Loading requests">
                  {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted" />)}
                </div>
              ) : isError ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <XCircle className="h-10 w-10 text-destructive/60" />
                  <p className="text-sm text-muted-foreground">Couldn't load requests.</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
                </div>
              ) : filteredRequests.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10"><CheckCircle2 className="h-8 w-8 text-success" /></div>
                  <p className="font-semibold text-foreground">{activeTab === 'pending' ? 'All caught up' : `No ${activeTab === 'all' ? '' : activeTab} requests`}</p>
                  <p className="text-sm">{activeTab === 'pending' ? 'New requests will appear here instantly.' : 'Try another filter.'}</p>
                </div>
              ) : (
                <ul className="max-h-[70vh] space-y-1 overflow-y-auto" aria-label="Requests">
                  {filteredRequests.map((r) => {
                    const config = getTypeConfig(r.approval_type);
                    const TypeIcon = config.icon;
                    const isSel = r.id === selectedId;
                    const open = () => { setSelectedId(r.id); if (!window.matchMedia('(min-width: 1024px)').matches) setMobileOpen(true); };
                    return (
                      <li key={r.id} data-anim="row" data-row-id={r.id}>
                        <div role="button" tabIndex={0} aria-current={isSel || undefined} onClick={open} onKeyDown={clickOnActivateKey}
                          className={`flex min-h-[56px] items-center gap-3 rounded-xl p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSel ? 'bg-primary/10' : 'hover:bg-muted/60'}`}>
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${config.color}`}><TypeIcon className="h-4 w-4" /></div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{memberOf(r)}</p>
                            <p className="truncate text-xs text-muted-foreground">{config.label} · {waited(r.created_at)} ago</p>
                          </div>
                          {r.status === 'pending' ? <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${urgency(r)}`} aria-label="Waiting time indicator" />
                            : <Badge variant="outline" className={`capitalize ${statusClass(r.status)}`}>{r.status}</Badge>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card data-anim="card" className="hidden rounded-2xl lg:col-span-7 lg:block">
            <CardContent className="p-5 lg:sticky lg:top-4" ref={panelRef}>
              {selected ? detailBody(selected) : (
                <div className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
                  <Clock className="h-10 w-10 opacity-40" />
                  <p>Select a request to review it</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={mobileOpen && !!selected} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] rounded-t-3xl lg:hidden">
          <SheetHeader className="sr-only"><SheetTitle>Request details</SheetTitle><SheetDescription>Review and decide</SheetDescription></SheetHeader>
          <div className="pt-4 pb-safe">{selected && detailBody(selected)}</div>
        </SheetContent>
      </Sheet>

      <ApproveLockerRequestSheet request={lockerApproval} onOpenChange={(o) => !o && setLockerApproval(null)} />
    </AppLayout>
  );
}

function StatCard({ label, value, icon: Icon, tone, active, onClick }: { label: string; value: number; icon: any; tone: string; active: boolean; onClick: () => void }) {
  const ref = useCountUp(value);
  return (
    <button type="button" data-anim="card" onClick={onClick} aria-pressed={active}
      className={`group flex flex-col justify-between rounded-2xl bg-card p-4 text-left shadow-sm transition-all [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'ring-2 ring-primary/40' : ''}`}>
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></div><div className="flex-1" />
      <p className="text-2xl font-bold tabular-nums"><span ref={ref}>0</span></p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </button>
  );
}
