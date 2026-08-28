import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { AddMemberDrawer } from '@/components/members/AddMemberDrawer';
import { PurchaseMembershipDrawer } from '@/components/members/PurchaseMembershipDrawer';
import { PurchasePTPackageDrawer } from '@/components/pt/PurchasePTPackageDrawer';
import { MemberProfileDrawer } from '@/components/members/MemberProfileDrawer';
import { QuickFreezeDrawer } from '@/components/members/QuickFreezeDrawer';
import { GroupPurchaseDrawer } from '@/components/members/GroupPurchaseDrawer';
import {
  MemberFilterBar,
  type MemberFilterState,
  type MemberStatusKey,
} from '@/components/members/MemberFilterBar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import {
  Search, Plus, Users, UserCheck, UserX, CreditCard, Dumbbell,
  Eye, Clock, Building2, AlertTriangle, CheckCircle, MoreHorizontal, Snowflake,
  ChevronLeft, ChevronRight, Download, UsersRound, Gift, CalendarClock, Wallet,
  ArrowUp, ArrowDown, ArrowUpDown, RefreshCw
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV } from '@/lib/csvExport';

import { useBranchContext } from '@/contexts/BranchContext';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { differenceInDays, format, startOfDay, startOfMonth, subDays } from 'date-fns';

const PAGE_SIZE = 20;

interface MemberRow {
  id: string;
  member_code: string | null;
  user_id: string | null;
  lead_id: string | null;
  branch_id: string | null;
  branch_name: string | null;
  assigned_trainer_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  derived_status: string;
  membership_id: string | null;
  plan_id: string | null;
  plan_name: string | null;
  start_date: string | null;
  end_date: string | null;
  days_left: number | null;
  dues: number | null;
  joined_at: string | null;
  total_count: number;
}

const DEFAULT_FILTERS: MemberFilterState = {
  search: '',
  statuses: [],
  planId: 'all',
  joinedRange: 'any',
  sort: 'joined',
  dir: 'desc',
};

function filtersFromUrl(): MemberFilterState {
  const p = new URLSearchParams(window.location.search);
  const statuses = (p.get('status') || '')
    .split(',')
    .filter(Boolean) as MemberStatusKey[];
  return {
    search: p.get('q') || '',
    statuses,
    planId: p.get('plan') || 'all',
    joinedRange: p.get('joined') || 'any',
    sort: p.get('sort') || 'joined',
    dir: (p.get('dir') === 'asc' ? 'asc' : 'desc'),
  };
}

function joinedBounds(range: string): { from: string | null; to: string | null } {
  const today = new Date();
  switch (range) {
    case '7d': return { from: format(subDays(today, 7), 'yyyy-MM-dd'), to: null };
    case '30d': return { from: format(subDays(today, 30), 'yyyy-MM-dd'), to: null };
    case 'month': return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: null };
    default: return { from: null, to: null };
  }
}

/** Shape an RPC row into the legacy member object the drawers expect. */
function toLegacyMember(r: MemberRow) {
  const msStatus =
    r.derived_status === 'frozen' ? 'frozen'
      : r.derived_status === 'scheduled' ? 'pending'
        : 'active';
  const membership = r.membership_id
    ? {
        id: r.membership_id,
        status: msStatus,
        start_date: r.start_date,
        end_date: r.end_date,
        plan_id: r.plan_id,
        membership_plans: r.plan_name ? { name: r.plan_name } : null,
      }
    : null;
  return {
    id: r.id,
    member_code: r.member_code,
    user_id: r.user_id,
    lead_id: r.lead_id,
    branch_id: r.branch_id,
    assigned_trainer_id: r.assigned_trainer_id,
    status: r.derived_status,
    created_at: r.joined_at,
    joined_at: r.joined_at,
    profiles: {
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      avatar_url: r.avatar_url,
    },
    branch: { name: r.branch_name, code: null },
    memberships: membership ? [membership] : [],
    activeMembership: r.derived_status === 'active' || r.derived_status === 'frozen' ? membership : null,
    scheduledMembership: r.derived_status === 'scheduled' ? membership : null,
    daysLeft: r.days_left,
    dues: Number(r.dues || 0),
    planName: r.plan_name,
    startDate: r.start_date,
    endDate: r.end_date,
  };
}

export default function MembersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchasePTOpen, setPurchasePTOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickFreezeOpen, setQuickFreezeOpen] = useState(false);
  const [groupPurchaseOpen, setGroupPurchaseOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [selectedMembershipForFreeze, setSelectedMembershipForFreeze] = useState<any>(null);
  const [filters, setFilters] = useState<MemberFilterState>(() => filtersFromUrl());
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [page, setPage] = useState(0);
  const { effectiveBranchId, branchFilter } = useBranchContext();

  // Debounce the search box so typing doesn't hammer the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Mirror filter state into the URL so a filtered view is shareable / refresh-safe.
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null) => {
      if (v) url.searchParams.set(k, v); else url.searchParams.delete(k);
    };
    set('q', filters.search.trim() || null);
    set('status', filters.statuses.length ? filters.statuses.join(',') : null);
    set('plan', filters.planId !== 'all' ? filters.planId : null);
    set('joined', filters.joinedRange !== 'any' ? filters.joinedRange : null);
    set('sort', filters.sort !== 'joined' ? filters.sort : null);
    set('dir', filters.dir !== 'desc' ? filters.dir : null);
    window.history.replaceState({}, '', url.toString());
  }, [filters]);

  const updateFilters = useCallback((next: MemberFilterState) => {
    setFilters(next);
    setPage(0);
  }, []);

  const toggleStatusFilter = (s: MemberStatusKey | 'all') => {
    if (s === 'all') { updateFilters({ ...filters, statuses: [] }); return; }
    updateFilters({
      ...filters,
      statuses: filters.statuses.length === 1 && filters.statuses[0] === s ? [] : [s],
    });
  };

  // Deep-link actions from Cmd+K command center
  useEffect(() => {
    const url = new URL(window.location.href);
    const stripParam = (k: string) => { url.searchParams.delete(k); window.history.replaceState({}, '', url.toString()); };
    if (url.searchParams.get('new') === '1') { setAddMemberOpen(true); stripParam('new'); }
    if (url.searchParams.get('sell') === '1') { setPurchaseOpen(true); stripParam('sell'); }
    if (url.searchParams.get('renew') === '1') { setPurchaseOpen(true); stripParam('renew'); }
  }, []);

  // Deep-link: /members?member=<id> auto-opens the member profile drawer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const memberId = params.get('member');
    if (!memberId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('members')
        .select(`
          id, member_code, user_id, lead_id, branch_id, status, created_at, assigned_trainer_id,
          profiles:user_id(full_name, email, phone, avatar_url),
          lead:lead_id(full_name, email, phone, avatar_url),
          branch:branch_id(name, code),
          memberships(id, status, start_date, end_date, plan_id, membership_plans(name))
        `)
        .eq('id', memberId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const d: any = data;
      const profiles = d.profiles || (d.lead ? {
        full_name: d.lead.full_name,
        email: d.lead.email,
        phone: d.lead.phone,
        avatar_url: d.lead.avatar_url,
      } : null);
      setSelectedMember({ ...d, profiles, joined_at: d.created_at });
      setProfileOpen(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Strip the ?member= param when the drawer closes so a refresh doesn't reopen it.
  const handleProfileOpenChange = (open: boolean) => {
    setProfileOpen(open);
    if (!open) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('member')) {
        url.searchParams.delete('member');
        window.history.replaceState({}, '', url.toString());
      }
    }
  };

  // Plans for the plan filter
  const { data: planOptions = [] } = useQuery({
    queryKey: ['membership-plan-options', branchFilter],
    queryFn: async () => {
      let q = supabase.from('membership_plans').select('id, name').order('name');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  // Server-side filtered / sorted / paginated member list.
  const joined = joinedBounds(filters.joinedRange);
  const {
    data: rows = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [
      'members', branchFilter, debouncedSearch, filters.statuses.join(','),
      filters.planId, filters.joinedRange, filters.sort, filters.dir, page,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_members_page', {
        p_branch_id: branchFilter || null,
        p_search: debouncedSearch.trim() || null,
        p_statuses: filters.statuses.length ? filters.statuses : null,
        p_plan_id: filters.planId !== 'all' ? filters.planId : null,
        p_joined_from: joined.from,
        p_joined_to: joined.to,
        p_sort: filters.sort,
        p_dir: filters.dir,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return (data || []) as unknown as MemberRow[];
    },
  });

  const members = useMemo(() => rows.map(toLegacyMember), [rows]);
  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const totalPages = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : 0;

  // Realtime: refresh list when self-onboarded members appear / change lifecycle.
  useEffect(() => {
    const channel = supabase
      .channel('members-lifecycle')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => {
        queryClient.invalidateQueries({ queryKey: ['members'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Gifted free days for the memberships on this page
  const activeMembershipIds = useMemo(
    () => members.map((m) => m.activeMembership?.id).filter(Boolean) as string[],
    [members],
  );

  const { data: freeDaysByMembership = {} } = useQuery<Record<string, number>>({
    queryKey: ['member-free-days', activeMembershipIds],
    queryFn: async () => {
      if (activeMembershipIds.length === 0) return {};
      const { data, error } = await supabase
        .from('membership_free_days')
        .select('membership_id, days_added')
        .in('membership_id', activeMembershipIds);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        map[r.membership_id] = (map[r.membership_id] || 0) + Number(r.days_added || 0);
      });
      return map;
    },
    enabled: activeMembershipIds.length > 0,
  });

  // Stats must reflect EVERY member in scope, not just the current page.
  const { data: statsRows = [] } = useQuery({
    queryKey: ['members-stats', branchFilter],
    queryFn: async () => {
      let q = supabase
        .from('members')
        .select('id, lifecycle_state, memberships(status, start_date, end_date)');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const counts = { total: 0, active: 0, scheduled: 0, inactive: 0, frozen: 0, expiringSoon: 0, pendingPlan: 0 };
    for (const m of statsRows as any[]) {
      counts.total += 1;
      const ms = m.memberships || [];
      const active = ms.find((x: any) => {
        const end = new Date(x.end_date); end.setHours(0, 0, 0, 0);
        return x.status === 'active' && end >= today;
      });
      const scheduled = ms.find((x: any) => {
        const start = startOfDay(new Date(x.start_date));
        return start > today && !['cancelled', 'expired', 'transferred'].includes(x.status);
      });
      const frozen = ms.find((x: any) => x.status === 'frozen');
      if (active) {
        counts.active += 1;
        const daysLeft = differenceInDays(new Date(active.end_date), today);
        if (daysLeft >= 0 && daysLeft <= 7) counts.expiringSoon += 1;
      } else if (m.lifecycle_state === 'pending_plan') counts.pendingPlan += 1;
      else if (scheduled) counts.scheduled += 1;
      else if (frozen) counts.frozen += 1;
      else counts.inactive += 1;
    }
    return counts;
  }, [statsRows]);

  const statusFilter = filters.statuses.length === 1 ? filters.statuses[0] : filters.statuses.length === 0 ? 'all' : 'multi';

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-success/10 text-success border-success/20',
      scheduled: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30',
      inactive: 'bg-muted text-muted-foreground border-muted',
      frozen: 'bg-info/10 text-info border-info/20',
      suspended: 'bg-destructive/10 text-destructive border-destructive/20',
      pending_plan: 'bg-warning/15 text-warning border-warning/30',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  const getDaysLeftColor = (days: number) => {
    if (days <= 0) return 'text-destructive';
    if (days <= 7) return 'text-destructive font-bold';
    if (days <= 30) return 'text-warning';
    return 'text-success';
  };

  const getDaysLeftIcon = (days: number) => {
    if (days <= 0) return <AlertTriangle className="h-3 w-3" />;
    if (days <= 7) return <Clock className="h-3 w-3" />;
    return <CheckCircle className="h-3 w-3" />;
  };

  const fmtDate = (d?: string | null) => (d ? format(new Date(d), 'dd MMM yy') : '--');

  const toggleSort = (key: string) => {
    if (filters.sort === key) {
      updateFilters({ ...filters, dir: filters.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      updateFilters({ ...filters, sort: key, dir: key === 'joined' || key === 'days_left' ? 'desc' : 'asc' });
    }
  };

  const handleViewProfile = (member: any) => {
    setSelectedMember(member);
    setProfileOpen(true);
  };

  const handlePurchaseMembership = (member: any) => {
    setSelectedMember(member);
    setPurchaseOpen(true);
  };

  const handlePurchasePT = (member: any) => {
    setSelectedMember(member);
    setPurchasePTOpen(true);
  };

  const handleQuickFreeze = (member: any) => {
    if (member.activeMembership) {
      setSelectedMember(member);
      setSelectedMembershipForFreeze(member.activeMembership);
      setQuickFreezeOpen(true);
    }
  };

  const statCards = [
    { key: 'all' as const, label: 'Total Members', value: stats.total, icon: Users, accent: 'border-l-primary', text: 'text-primary', bg: 'bg-primary/10', bar: 'bg-primary' },
    { key: 'active' as const, label: 'Active', value: stats.active, icon: UserCheck, accent: 'border-l-success', text: 'text-success', bg: 'bg-success/10', bar: 'bg-success' },
    { key: 'scheduled' as const, label: 'Scheduled', value: stats.scheduled, icon: CalendarClock, accent: 'border-l-indigo-500', text: 'text-indigo-600 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-500/10', bar: 'bg-indigo-500' },
    { key: 'inactive' as const, label: 'Inactive', value: stats.inactive, icon: UserX, accent: 'border-l-muted-foreground', text: 'text-foreground', bg: 'bg-muted', bar: 'bg-muted-foreground' },
    { key: 'frozen' as const, label: 'Frozen', value: stats.frozen, icon: Snowflake, accent: 'border-l-info', text: 'text-info', bg: 'bg-info/10', bar: 'bg-info' },
    { key: 'expiring_soon' as const, label: 'Expiring ≤7d', value: stats.expiringSoon, icon: AlertTriangle, accent: 'border-l-warning', text: 'text-warning', bg: 'bg-warning/10', bar: 'bg-warning' },
  ];

  const renderDaysLeftCell = (member: any) => {
    const daysLeft = member.daysLeft;
    if (member.derived_status === 'scheduled' || member.scheduledMembership) {
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
            <CalendarClock className="h-3 w-3" />
            <span className="font-medium tabular-nums">
              Starts in {Math.max(0, differenceInDays(new Date(member.scheduledMembership.start_date), new Date()))}d
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {fmtDate(member.startDate)} – {fmtDate(member.endDate)}
          </span>
        </div>
      );
    }
    if (daysLeft === null || daysLeft === undefined || !member.activeMembership) {
      return <span className="text-muted-foreground">--</span>;
    }
    return (
      <div className="flex flex-col gap-0.5">
        <div className={`flex items-center gap-1.5 ${getDaysLeftColor(daysLeft)}`}>
          {getDaysLeftIcon(daysLeft)}
          <span className="font-medium tabular-nums">{daysLeft > 0 ? `${daysLeft}d` : 'Expired'}</span>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {fmtDate(member.startDate)} – {fmtDate(member.endDate)}
        </span>
        {member.activeMembership?.id && freeDaysByMembership[member.activeMembership.id] > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="bg-warning/15 text-warning border-warning/40 text-[10px] w-fit gap-1">
                <Gift className="h-3 w-3" />
                +{freeDaysByMembership[member.activeMembership.id]}d gift
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Includes gifted free days</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  const statusLabel = (member: any) =>
    member.status === 'pending_plan'
      ? 'Pending Plan'
      : member.status === 'frozen'
        ? 'Frozen'
        : member.status === 'scheduled' && member.scheduledMembership?.start_date
          ? `Scheduled · ${format(new Date(member.scheduledMembership.start_date), 'dd MMM')}`
          : member.status === 'active' ? 'Active' : 'Inactive';

  const renderPlanBadges = (member: any) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      {member.planName ? (
        <Badge className={member.status === 'scheduled' ? 'bg-indigo-600 text-white hover:bg-indigo-600' : 'bg-success/10 text-success'}>
          {member.planName}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground border-dashed">No Plan</Badge>
      )}
      {member.status === 'frozen' && (
        <Badge variant="outline" className="bg-info/10 text-info border-info/20 text-xs">
          <Snowflake className="h-3 w-3 mr-0.5" />Frozen
        </Badge>
      )}
      {member.dues > 0 && (
        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs tabular-nums">
          Due ₹{member.dues.toLocaleString()}
        </Badge>
      )}
    </div>
  );

  const renderActions = (member: any) => (
    <div className="flex items-center justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`View profile of ${member.profiles?.full_name || member.member_code}`} onClick={() => handleViewProfile(member)}>
            <Eye className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>View Profile</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handlePurchaseMembership(member)}>
            <CreditCard className="h-4 w-4 mr-2" />
            {member.activeMembership
              ? 'Renew Plan'
              : member.scheduledMembership
                ? 'Reschedule / Change Plan'
                : 'Add Plan'}
          </DropdownMenuItem>
          {member.dues > 0 && (
            <DropdownMenuItem onClick={() => navigate(`/members/${member.id}?tab=invoices`)}>
              <Wallet className="h-4 w-4 mr-2 text-destructive" />
              Collect Due ₹{member.dues.toLocaleString()}
            </DropdownMenuItem>
          )}
          {(member.activeMembership || member.scheduledMembership) && (
            <>
              <DropdownMenuItem onClick={() => handlePurchasePT(member)}>
                <Dumbbell className="h-4 w-4 mr-2" />
                Buy PT Package
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => member.activeMembership && handleQuickFreeze(member)}
                disabled={!member.activeMembership || member.status === 'frozen'}
              >
                <Snowflake className="h-4 w-4 mr-2" />
                Quick Freeze
              </DropdownMenuItem>
            </>
          )}
          {member.status === 'frozen' && member.activeMembership && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                setSelectedMember(member);
                setSelectedMembershipForFreeze(member.activeMembership);
                setQuickFreezeOpen(true);
              }}>
                <Snowflake className="h-4 w-4 mr-2 text-info" />
                Unfreeze Membership
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const emptyMessage = debouncedSearch.trim()
    ? 'No members match your search'
    : filters.statuses.length > 0
      ? 'No members match these filters'
      : 'No members found';

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Members</h1>
            <p className="text-muted-foreground">Manage your gym members and their memberships</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setGroupPurchaseOpen(true)} className="gap-2" disabled={!effectiveBranchId}>
              <UsersRound className="h-4 w-4" />
              Group Purchase
            </Button>
            <Button onClick={() => setAddMemberOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Member
            </Button>
          </div>
        </div>

        {/* Stats Row — each card drives the server-side filter */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {statCards.map((c) => {
            const Icon = c.icon;
            const selected = statusFilter === c.key;
            return (
              <Card
                key={c.key}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => toggleStatusFilter(c.key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStatusFilter(c.key); } }}
                className={`relative overflow-hidden rounded-2xl border-l-4 ${c.accent} cursor-pointer transition-all duration-200 hover:shadow-xl hover:shadow-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{c.label}</p>
                      <p className={`text-3xl font-bold tabular-nums ${c.text}`}>{c.value}</p>
                    </div>
                    <div className={`h-12 w-12 rounded-full ${c.bg} flex items-center justify-center`}>
                      <Icon className={`h-6 w-6 ${c.text}`} />
                    </div>
                  </div>
                  {selected && <div className={`absolute bottom-0 left-0 right-0 h-1 ${c.bar}`} />}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Members Table */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-4 gap-4">
            <MemberFilterBar
              value={filters}
              onChange={updateFilters}
              plans={planOptions}
              resultCount={totalCount}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => refetch()}
                aria-label="Refresh list"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                const csv = members.map((m: any) => ({
                  Name: m.profiles?.full_name || '',
                  Code: m.member_code,
                  Email: m.profiles?.email || '',
                  Phone: m.profiles?.phone || '',
                  Status: m.status,
                  Plan: m.planName || '',
                  'Start Date': m.startDate || '',
                  'End Date': m.endDate || '',
                  'Days Left': m.daysLeft ?? '',
                  Dues: m.dues || 0,
                  Joined: m.joined_at ? format(new Date(m.joined_at), 'yyyy-MM-dd') : '',
                }));
                exportToCSV(csv, 'members');
              }}>
                <Download className="h-4 w-4" /> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <TableSkeleton rows={8} columns={8} />
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
                <div className="p-3 rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <p className="text-sm text-muted-foreground">We couldn’t load the member list.</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
              </div>
            ) : members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
                <div className="p-3 rounded-full bg-muted">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                {(filters.statuses.length > 0 || filters.search || filters.planId !== 'all' || filters.joinedRange !== 'any') && (
                  <Button variant="outline" size="sm" onClick={() => updateFilters({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir })}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-border/50">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        {([
                          ['name', 'Member'],
                          ['code', 'Code'],
                          ['branch', 'Branch'],
                          ['status', 'Status'],
                          ['membership', 'Membership'],
                          ['days_left', 'Days Left'],
                          ['joined', 'Joined'],
                        ] as [string, string][]).map(([key, label]) => (
                          <TableHead key={key} className="font-semibold">
                            <button
                              type="button"
                              onClick={() => toggleSort(key)}
                              aria-label={`Sort by ${label}`}
                              className="inline-flex items-center gap-1 cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-primary/40 hover:text-foreground transition-colors"
                            >
                              {label}
                              {filters.sort === key
                                ? (filters.dir === 'asc'
                                    ? <ArrowUp className="h-3.5 w-3.5" />
                                    : <ArrowDown className="h-3.5 w-3.5" />)
                                : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                            </button>
                          </TableHead>
                        ))}
                        <TableHead className="font-semibold text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member: any) => (
                        <TableRow
                          key={member.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors group"
                          onClick={() => handleViewProfile(member)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <Avatar className="h-10 w-10 ring-2 ring-background shadow-sm">
                                  <AvatarImage src={member.profiles?.avatar_url} alt="" />
                                  <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-semibold">
                                    {member.profiles?.full_name?.charAt(0) || 'M'}
                                  </AvatarFallback>
                                </Avatar>
                                <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${
                                  member.status === 'active' ? 'bg-success' : member.status === 'scheduled' ? 'bg-indigo-500' : member.status === 'frozen' ? 'bg-info' : 'bg-muted-foreground'
                                }`} />
                              </div>
                              <div>
                                <div className="font-medium group-hover:text-primary transition-colors">{member.profiles?.full_name || 'N/A'}</div>
                                <div className="text-sm text-muted-foreground">{member.profiles?.phone || member.profiles?.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <code className="px-2 py-1 text-xs rounded bg-muted font-mono">{member.member_code}</code>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Building2 className="h-3.5 w-3.5" />
                              {member.branch?.name || 'N/A'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${getStatusColor(member.status)} gap-1 rounded-full`}>
                              {member.status === 'frozen' && <Snowflake className="h-3 w-3" />}
                              {member.status === 'scheduled' && <CalendarClock className="h-3 w-3" />}
                              {statusLabel(member)}
                            </Badge>
                          </TableCell>
                          <TableCell>{renderPlanBadges(member)}</TableCell>
                          <TableCell>{renderDaysLeftCell(member)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground tabular-nums">
                            {member.joined_at && !isNaN(new Date(member.joined_at).getTime())
                              ? format(new Date(member.joined_at), 'dd MMM yy')
                              : '--'}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {renderActions(member)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile stacked cards */}
                <div className="md:hidden space-y-3">
                  {members.map((member: any) => (
                    <div
                      key={member.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleViewProfile(member)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleViewProfile(member); }}
                      className="rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 dark:shadow-none transition-all duration-200 hover:shadow-xl cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar className="h-11 w-11">
                          <AvatarImage src={member.profiles?.avatar_url} alt="" />
                          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                            {member.profiles?.full_name?.charAt(0) || 'M'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium truncate">{member.profiles?.full_name || 'N/A'}</p>
                            <Badge variant="outline" className={`${getStatusColor(member.status)} rounded-full text-[10px]`}>
                              {statusLabel(member)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{member.member_code} · {member.profiles?.phone || '—'}</p>
                          <div className="mt-2">{renderPlanBadges(member)}</div>
                          <div className="mt-2 text-xs">{renderDaysLeftCell(member)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                        {renderActions(member)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
                  <p className="text-sm text-muted-foreground tabular-nums">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} members
                  </p>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <span className="text-sm font-medium px-2 tabular-nums">
                        Page {page + 1} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= totalPages - 1}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Drawers */}
        <AddMemberDrawer
          open={addMemberOpen}
          onOpenChange={setAddMemberOpen}
          branchId={effectiveBranchId}
        />

        {selectedMember && (
          <>
            <PurchaseMembershipDrawer
              open={purchaseOpen}
              onOpenChange={setPurchaseOpen}
              memberId={selectedMember.id}
              memberName={selectedMember.profiles?.full_name || selectedMember.member_code}
              branchId={selectedMember.branch_id}
            />
            <PurchasePTPackageDrawer
              open={purchasePTOpen}
              onOpenChange={setPurchasePTOpen}
              memberId={selectedMember.id}
              memberName={selectedMember.profiles?.full_name || selectedMember.member_code}
              branchId={selectedMember.branch_id}
            />
            <MemberProfileDrawer
              open={profileOpen}
              onOpenChange={handleProfileOpenChange}
              member={selectedMember}
              onPurchaseMembership={() => { setProfileOpen(false); setPurchaseOpen(true); }}
              onPurchasePT={() => { setProfileOpen(false); setPurchasePTOpen(true); }}
            />
            {selectedMembershipForFreeze && (
              <QuickFreezeDrawer
                open={quickFreezeOpen}
                onOpenChange={setQuickFreezeOpen}
                member={selectedMember}
                activeMembership={selectedMembershipForFreeze}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['members'] })}
              />
            )}
          </>
        )}
        {effectiveBranchId && (
          <GroupPurchaseDrawer
            open={groupPurchaseOpen}
            onOpenChange={setGroupPurchaseOpen}
            branchId={effectiveBranchId}
          />
        )}
      </div>
    </AppLayout>
  );
}
