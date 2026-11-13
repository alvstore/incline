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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

__TAIL__