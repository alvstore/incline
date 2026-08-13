import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddMemberDrawer } from '@/components/members/AddMemberDrawer';
import { PurchaseMembershipDrawer } from '@/components/members/PurchaseMembershipDrawer';
import { PurchasePTPackageDrawer } from '@/components/pt/PurchasePTPackageDrawer';
import { MemberProfileDrawer } from '@/components/members/MemberProfileDrawer';
import { QuickFreezeDrawer } from '@/components/members/QuickFreezeDrawer';
import { GroupPurchaseDrawer } from '@/components/members/GroupPurchaseDrawer';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Search, Plus, Users, UserCheck, UserX, CreditCard, Dumbbell, Eye, Clock, Building2, AlertTriangle, CheckCircle, MoreHorizontal, Snowflake, ChevronLeft, ChevronRight, Download, UsersRound, Gift, CalendarClock, Wallet, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV } from '@/lib/csvExport';
import { useBranchContext } from '@/contexts/BranchContext';
import { useState, useMemo, useEffect } from 'react';
import { differenceInDays, format, startOfDay } from 'date-fns';
import { daysRemaining } from '@/lib/memberships/duration';
const PAGE_SIZE = 20;
export default function MembersPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [addMemberOpen, setAddMemberOpen] = useState(false);
    const [purchaseOpen, setPurchaseOpen] = useState(false);
    const [purchasePTOpen, setPurchasePTOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [quickFreezeOpen, setQuickFreezeOpen] = useState(false);
    const [groupPurchaseOpen, setGroupPurchaseOpen] = useState(false);
    const [selectedMember, setSelectedMember] = useState(null);
    const [selectedMembershipForFreeze, setSelectedMembershipForFreeze] = useState(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [page, setPage] = useState(0);
    const [sortKey, setSortKey] = useState('default');
    const [sortDir, setSortDir] = useState('desc');
    const { selectedBranch, setSelectedBranch, effectiveBranchId, branchFilter, branches } = useBranchContext();
    // Deep-link actions from Cmd+K command center
    useEffect(() => {
        const url = new URL(window.location.href);
        const stripParam = (k) => { url.searchParams.delete(k); window.history.replaceState({}, '', url.toString()); };
        if (url.searchParams.get('new') === '1') {
            setAddMemberOpen(true);
            stripParam('new');
        }
        if (url.searchParams.get('sell') === '1') {
            setPurchaseOpen(true);
            stripParam('sell');
        }
        if (url.searchParams.get('renew') === '1') {
            setPurchaseOpen(true);
            stripParam('renew');
        }
    }, []);
    // Deep-link: /members?member=<id> auto-opens the member profile drawer.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const memberId = params.get('member');
        if (!memberId)
            return;
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
            if (cancelled || error || !data)
                return;
            const d = data;
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
    const handleProfileOpenChange = (open) => {
        setProfileOpen(open);
        if (!open) {
            const url = new URL(window.location.href);
            if (url.searchParams.has('member')) {
                url.searchParams.delete('member');
                window.history.replaceState({}, '', url.toString());
            }
        }
    };
    // Reset page on search/filter changes
    const handleSearchChange = (val) => { setSearch(val); setPage(0); };
    const handleStatusFilter = (val) => { setStatusFilter(val); setPage(0); };
    // Fetch members with server-side pagination
    const { data: membersResult, isLoading } = useQuery({
        queryKey: ['members', search, branchFilter, page],
        queryFn: async () => {
            if (search && search.trim().length > 0) {
                const { data, error } = await supabase
                    .rpc('search_members', {
                    search_term: search.trim(),
                    p_branch_id: branchFilter || null,
                    p_limit: PAGE_SIZE
                });
                if (error)
                    throw error;
                // search_members does not return created_at — hydrate the real joined
                // date so the profile drawer never falls back to the epoch (01 Jan 1970).
                const ids = (data || []).map((r) => r.id);
                const joinedMap = new Map();
                if (ids.length > 0) {
                    const { data: joinRows } = await supabase
                        .from('members')
                        .select('id, created_at')
                        .in('id', ids);
                    (joinRows || []).forEach((r) => joinedMap.set(r.id, r.created_at));
                }
                return {
                    data: (data || []).map((row) => ({
                        id: row.id,
                        member_code: row.member_code,
                        user_id: row.user_id,
                        branch_id: row.branch_id,
                        joined_at: joinedMap.get(row.id) ?? null,
                        status: row.member_status || 'inactive',
                        profiles: {
                            full_name: row.full_name,
                            email: row.email,
                            phone: row.phone,
                            avatar_url: row.avatar_url
                        },
                        branch: {
                            name: row.branch_name ||
                                branches.find((b) => b.id === row.branch_id)?.name ||
                                null,
                            code: row.branch_code || null,
                        },
                        memberships: []
                    })),
                    count: null // RPC doesn't return total count
                };
            }
            else {
                let query = supabase
                    .from('members')
                    .select(`
            id, member_code, user_id, lead_id, branch_id, status, lifecycle_state, created_at, assigned_trainer_id,
            profiles:user_id(full_name, email, phone, avatar_url),
            lead:lead_id(full_name, email, phone, avatar_url),
            branch:branch_id(name, code),
            memberships(id, status, start_date, end_date, plan_id, membership_plans(name))
          `, { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
                if (branchFilter) {
                    query = query.eq('branch_id', branchFilter);
                }
                const { data, error, count } = await query;
                if (error)
                    throw error;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const mapped = (data || []).map((m) => {
                    const activeMembership = m.memberships?.find((ms) => {
                        const end = new Date(ms.end_date);
                        end.setHours(0, 0, 0, 0);
                        return ms.status === 'active' && end >= today;
                    });
                    const scheduledMembership = m.memberships?.find((ms) => {
                        if (ms.status !== 'pending')
                            return false;
                        const start = new Date(ms.start_date);
                        start.setHours(0, 0, 0, 0);
                        return start > today;
                    });
                    const frozenMembership = m.memberships?.find((ms) => ms.status === 'frozen');
                    let memberStatus = 'inactive';
                    // Active plan wins over any stale lifecycle flag — the DB clears
                    // lifecycle_state via trigger, but this keeps the UI correct during
                    // the brief window before that fires.
                    if (activeMembership)
                        memberStatus = 'active';
                    else if (m.lifecycle_state === 'pending_plan')
                        memberStatus = 'pending_plan';
                    else if (scheduledMembership)
                        memberStatus = 'scheduled';
                    else if (frozenMembership)
                        memberStatus = 'frozen';
                    // Fall back to lead PII when the member has no linked profile yet
                    // (lead→member conversion creates the member with user_id = NULL until
                    // the member sets a password and an auth/profile row is created).
                    const profiles = m.profiles || (m.lead ? {
                        full_name: m.lead.full_name,
                        email: m.lead.email,
                        phone: m.lead.phone,
                        avatar_url: m.lead.avatar_url,
                    } : null);
                    return { ...m, profiles, status: memberStatus, scheduledMembership, joined_at: m.created_at };
                });
                // Ordering: pending self-registrations first (reception action queue),
                // then members with real cover (active → scheduled → frozen), and only
                // then members without any membership. Recency breaks ties.
                const rank = (s) => {
                    switch (s) {
                        case 'pending_plan': return 0;
                        case 'active': return 1;
                        case 'scheduled': return 2;
                        case 'frozen': return 3;
                        default: return 4;
                    }
                };
                mapped.sort((a, b) => {
                    const d = rank(a.status) - rank(b.status);
                    if (d !== 0)
                        return d;
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });
                return { data: mapped, count };
            }
        },
    });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const members = membersResult?.data || [];
    const totalCount = membersResult?.count;
    const totalPages = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : null;
    // Fetch memberships for searched members
    const memberIds = useMemo(() => members.map((m) => m.id), [members]);
    const { data: memberships = [] } = useQuery({
        queryKey: ['member-memberships', memberIds],
        queryFn: async () => {
            if (memberIds.length === 0)
                return [];
            const { data } = await supabase
                .from('memberships')
                .select('id, member_id, status, start_date, end_date, plan_id, membership_plans(name)')
                .in('member_id', memberIds);
            return data || [];
        },
        enabled: memberIds.length > 0 && search.length > 0,
    });
    // Merge memberships into members for search results + re-derive status so
    // search results respect the scheduled/active/frozen distinction (the RPC
    // only returns the raw members.status column).
    const membersWithMemberships = useMemo(() => {
        if (!search || memberships.length === 0)
            return members;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const membershipMap = new Map();
        memberships.forEach((ms) => {
            if (!membershipMap.has(ms.member_id)) {
                membershipMap.set(ms.member_id, []);
            }
            membershipMap.get(ms.member_id).push(ms);
        });
        return members.map((m) => {
            const list = membershipMap.get(m.id) || [];
            const activeMembership = list.find((ms) => {
                const end = new Date(ms.end_date);
                end.setHours(0, 0, 0, 0);
                return ms.status === 'active' && end >= today;
            });
            const scheduledMembership = list.find((ms) => {
                if (ms.status !== 'pending')
                    return false;
                const start = new Date(ms.start_date);
                start.setHours(0, 0, 0, 0);
                return start > today;
            });
            const frozenMembership = list.find((ms) => ms.status === 'frozen');
            let memberStatus = m.status === 'pending_plan' ? 'pending_plan' : 'inactive';
            if (m.status === 'pending_plan')
                memberStatus = 'pending_plan';
            else if (activeMembership)
                memberStatus = 'active';
            else if (scheduledMembership)
                memberStatus = 'scheduled';
            else if (frozenMembership)
                memberStatus = 'frozen';
            return { ...m, memberships: list, scheduledMembership, status: memberStatus };
        });
    }, [members, memberships, search]);
    // Bulk-fetch outstanding dues for the current page of members so we can
    // surface a "Dues" badge inline without per-row queries.
    const { data: duesByMember = {} } = useQuery({
        queryKey: ['member-dues', memberIds],
        queryFn: async () => {
            if (memberIds.length === 0)
                return {};
            const { data, error } = await supabase
                .from('invoices')
                .select('member_id, total_amount, amount_paid, status')
                .in('member_id', memberIds)
                .in('status', ['pending', 'partial', 'overdue']);
            if (error)
                throw error;
            const map = {};
            (data || []).forEach((inv) => {
                const due = Number(inv.total_amount || 0) - Number(inv.amount_paid || 0);
                if (due > 0)
                    map[inv.member_id] = (map[inv.member_id] || 0) + due;
            });
            return map;
        },
        enabled: memberIds.length > 0,
    });
    // Filter by member status
    const statusFiltered = statusFilter === 'all'
        ? membersWithMemberships
        : membersWithMemberships.filter((m) => m.status === statusFilter);
    // Column sorting (applies to the current page of results)
    const toggleSort = (key) => {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        }
        else {
            setSortKey(key);
            setSortDir(key === 'joined' || key === 'days_left' ? 'desc' : 'asc');
        }
    };
    const filteredMembers = useMemo(() => {
        if (sortKey === 'default')
            return statusFiltered;
        const pickMembership = (m) => {
            const list = m.memberships || [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return list.find((x) => x.status === 'active' && new Date(x.end_date) >= today)
                || list.find((x) => x.status === 'frozen')
                || m.scheduledMembership
                || null;
        };
        const value = (m) => {
            switch (sortKey) {
                case 'name': return (m.profiles?.full_name || '').toLowerCase();
                case 'code': return (m.member_code || '').toLowerCase();
                case 'branch': return (m.branches?.name || m.branch?.name || '').toLowerCase();
                case 'status': return (m.status || '').toLowerCase();
                case 'membership': return (pickMembership(m)?.membership_plans?.name || '').toLowerCase();
                case 'days_left': {
                    const ms = pickMembership(m);
                    return ms ? daysRemaining(ms.end_date) : -99999;
                }
                case 'joined': return new Date(m.created_at || 0).getTime();
                default: return 0;
            }
        };
        return [...statusFiltered].sort((a, b) => {
            const av = value(a);
            const bv = value(b);
            let d = 0;
            if (typeof av === 'number' && typeof bv === 'number')
                d = av - bv;
            else
                d = String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? d : -d;
        });
    }, [statusFiltered, sortKey, sortDir]);
    // Stats must reflect EVERY member in scope, not just the current page.
    const { data: statsRows = [] } = useQuery({
        queryKey: ['members-stats', branchFilter],
        queryFn: async () => {
            let q = supabase
                .from('members')
                .select('id, lifecycle_state, memberships(status, start_date, end_date)');
            if (branchFilter)
                q = q.eq('branch_id', branchFilter);
            const { data, error } = await q;
            if (error)
                throw error;
            return data || [];
        },
    });
    const stats = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const counts = { total: 0, active: 0, scheduled: 0, inactive: 0, frozen: 0, expiringSoon: 0, pendingPlan: 0 };
        for (const m of statsRows) {
            counts.total += 1;
            const ms = m.memberships || [];
            const active = ms.find((x) => {
                const end = new Date(x.end_date);
                end.setHours(0, 0, 0, 0);
                return x.status === 'active' && end >= today;
            });
            const scheduled = ms.find((x) => {
                if (x.status !== 'pending')
                    return false;
                const start = startOfDay(new Date(x.start_date));
                return start > today;
            });
            const frozen = ms.find((x) => x.status === 'frozen');
            if (active) {
                counts.active += 1;
                const daysLeft = differenceInDays(new Date(active.end_date), today);
                if (daysLeft >= 0 && daysLeft <= 7)
                    counts.expiringSoon += 1;
            }
            else if (m.lifecycle_state === 'pending_plan')
                counts.pendingPlan += 1;
            else if (scheduled)
                counts.scheduled += 1;
            else if (frozen)
                counts.frozen += 1;
            else
                counts.inactive += 1;
        }
        return counts;
    }, [statsRows]);
    const getStatusColor = (status) => {
        const colors = {
            active: 'bg-success/10 text-success border-success/20',
            scheduled: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30',
            inactive: 'bg-muted text-muted-foreground border-muted',
            frozen: 'bg-info/10 text-info border-info/20',
            suspended: 'bg-destructive/10 text-destructive border-destructive/20',
            pending_plan: 'bg-warning/15 text-warning border-warning/30 animate-pulse',
        };
        return colors[status] || 'bg-muted text-muted-foreground';
    };
    const getMembershipStatusColor = (status) => {
        if (!status)
            return 'bg-muted text-muted-foreground';
        const colors = {
            active: 'bg-success/10 text-success',
            expired: 'bg-destructive/10 text-destructive',
            frozen: 'bg-warning/10 text-warning',
            cancelled: 'bg-muted text-muted-foreground',
        };
        return colors[status] || 'bg-muted text-muted-foreground';
    };
    const getDaysLeftColor = (days) => {
        if (days <= 0)
            return 'text-destructive';
        if (days <= 7)
            return 'text-destructive font-bold';
        if (days <= 30)
            return 'text-warning';
        return 'text-success';
    };
    const getDaysLeftIcon = (days) => {
        if (days <= 0)
            return <AlertTriangle className="h-3 w-3"/>;
        if (days <= 7)
            return <Clock className="h-3 w-3"/>;
        return <CheckCircle className="h-3 w-3"/>;
    };
    const getActiveMembership = (memberships) => {
        if (!memberships || memberships.length === 0)
            return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return memberships.find((m) => {
            const end = new Date(m.end_date);
            end.setHours(0, 0, 0, 0);
            return m.status === 'active' && end >= today;
        })
            || memberships.find((m) => m.status === 'frozen');
    };
    const getDaysRemaining = (membership) => {
        if (!membership)
            return null;
        return daysRemaining(membership.end_date);
    };
    // Fetch gifted free days (extensions) for active memberships on this page
    const activeMembershipIds = useMemo(() => {
        return membersWithMemberships
            .map((m) => getActiveMembership(m.memberships)?.id)
            .filter(Boolean);
    }, [membersWithMemberships]);
    const { data: freeDaysByMembership = {} } = useQuery({
        queryKey: ['member-free-days', activeMembershipIds],
        queryFn: async () => {
            if (activeMembershipIds.length === 0)
                return {};
            const { data, error } = await supabase
                .from('membership_free_days')
                .select('membership_id, days_added')
                .in('membership_id', activeMembershipIds);
            if (error)
                throw error;
            const map = {};
            (data || []).forEach((r) => {
                map[r.membership_id] = (map[r.membership_id] || 0) + Number(r.days_added || 0);
            });
            return map;
        },
        enabled: activeMembershipIds.length > 0,
    });
    const handleViewProfile = (member) => {
        setSelectedMember(member);
        setProfileOpen(true);
    };
    const handlePurchaseMembership = (member) => {
        setSelectedMember(member);
        setPurchaseOpen(true);
    };
    const handlePurchasePT = (member) => {
        setSelectedMember(member);
        setPurchasePTOpen(true);
    };
    const handleQuickFreeze = (member) => {
        const activeMembership = getActiveMembership(member.memberships);
        if (activeMembership) {
            setSelectedMember(member);
            setSelectedMembershipForFreeze(activeMembership);
            setQuickFreezeOpen(true);
        }
    };
    return (<AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Members</h1>
            <p className="text-muted-foreground">Manage your gym members and their memberships</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setGroupPurchaseOpen(true)} className="gap-2" disabled={!effectiveBranchId}>
              <UsersRound className="h-4 w-4"/>
              Group Purchase
            </Button>
            <Button onClick={() => setAddMemberOpen(true)} className="gap-2">
              <Plus className="h-4 w-4"/>
              Add Member
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <Card className="relative overflow-hidden border-l-4 border-l-primary hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleStatusFilter('all')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Members</p>
                  <p className="text-3xl font-bold text-primary">{stats.total}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary"/>
                </div>
              </div>
              {statusFilter === 'all' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary"/>}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-l-4 border-l-success hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleStatusFilter('active')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active</p>
                  <p className="text-3xl font-bold text-success">{stats.active}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                  <UserCheck className="h-6 w-6 text-success"/>
                </div>
              </div>
              {statusFilter === 'active' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-success"/>}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleStatusFilter('scheduled')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Scheduled</p>
                  <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-300">{stats.scheduled}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                  <CalendarClock className="h-6 w-6 text-indigo-600 dark:text-indigo-300"/>
                </div>
              </div>
              {statusFilter === 'scheduled' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500"/>}
            </CardContent>
          </Card>


          <Card className="relative overflow-hidden border-l-4 border-l-muted-foreground hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleStatusFilter('inactive')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Inactive</p>
                  <p className="text-3xl font-bold">{stats.inactive}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <UserX className="h-6 w-6 text-muted-foreground"/>
                </div>
              </div>
              {statusFilter === 'inactive' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted-foreground"/>}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-l-4 border-l-info hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleStatusFilter('frozen')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Frozen</p>
                  <p className="text-3xl font-bold text-info">{stats.frozen}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-info/10 flex items-center justify-center">
                  <Snowflake className="h-6 w-6 text-info"/>
                </div>
              </div>
              {statusFilter === 'frozen' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-info"/>}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-l-4 border-l-warning hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Expiring Soon</p>
                  <p className="text-3xl font-bold text-warning">{stats.expiringSoon}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-warning"/>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Members Table */}
        <Card className="border-border/50">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                <Input placeholder="Search by name, email, phone, or member code..." value={search} onChange={(e) => handleSearchChange(e.target.value)} className="pl-10 h-11 bg-muted/30 border-border/50 focus:bg-background transition-colors"/>
              </div>
              {statusFilter !== 'all' && (<Button variant="ghost" size="sm" onClick={() => handleStatusFilter('all')}>
                  Clear filter
                </Button>)}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
            const rows = filteredMembers.map((m) => {
                const ms = getActiveMembership(m.memberships);
                return {
                    Name: m.profiles?.full_name || '',
                    Code: m.member_code,
                    Email: m.profiles?.email || '',
                    Phone: m.profiles?.phone || '',
                    Status: m.status,
                    Plan: ms?.membership_plans?.name || '',
                    'End Date': ms?.end_date || '',
                    Joined: m.created_at ? format(new Date(m.created_at), 'yyyy-MM-dd') : '',
                };
            });
            exportToCSV(rows, 'members');
        }}>
                <Download className="h-4 w-4"/> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (<TableSkeleton rows={8} columns={8}/>) : (<>
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        {[
                ['name', 'Member'],
                ['code', 'Code'],
                ['branch', 'Branch'],
                ['status', 'Status'],
                ['membership', 'Membership'],
                ['days_left', 'Days Left'],
                ['joined', 'Joined'],
            ].map(([key, label]) => (<TableHead key={key} className="font-semibold">
                            <button type="button" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`} className="inline-flex items-center gap-1 cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-primary/40 hover:text-foreground transition-colors">
                              {label}
                              {sortKey === key
                    ? (sortDir === 'asc'
                        ? <ArrowUp className="h-3.5 w-3.5"/>
                        : <ArrowDown className="h-3.5 w-3.5"/>)
                    : <ArrowUpDown className="h-3.5 w-3.5 opacity-40"/>}
                            </button>
                          </TableHead>))}
                        <TableHead className="font-semibold text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMembers.map((member) => {
                const activeMembership = getActiveMembership(member.memberships);
                const scheduledMembership = member.scheduledMembership;
                const existingPlan = activeMembership || scheduledMembership;
                const memberDue = duesByMember[member.id] || 0;
                const daysLeft = getDaysRemaining(activeMembership);
                return (<TableRow key={member.id} className="cursor-pointer hover:bg-muted/50 transition-colors group" onClick={() => handleViewProfile(member)}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="relative">
                                  <Avatar className="h-10 w-10 ring-2 ring-background shadow-sm">
                                    <AvatarImage src={member.profiles?.avatar_url}/>
                                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-semibold">
                                      {member.profiles?.full_name?.charAt(0) || 'M'}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${member.status === 'active' ? 'bg-success' : member.status === 'scheduled' ? 'bg-indigo-500' : member.status === 'frozen' ? 'bg-info' : member.status === 'suspended' ? 'bg-destructive' : 'bg-muted-foreground'}`}/>
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
                                <Building2 className="h-3.5 w-3.5"/>
                                {member.branch?.name || 'N/A'}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`${getStatusColor(member.status)} gap-1`}>
                                {member.status === 'frozen' && <Snowflake className="h-3 w-3"/>}
                                {member.status === 'scheduled' && <CalendarClock className="h-3 w-3"/>}
                                {member.status === 'pending_plan'
                        ? 'Pending Plan'
                        : member.status === 'frozen'
                            ? 'Frozen'
                            : member.status === 'scheduled' && member.scheduledMembership?.start_date
                                ? `Scheduled · ${format(new Date(member.scheduledMembership.start_date), 'dd MMM')}`
                                : member.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {activeMembership ? (<div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge className={getMembershipStatusColor(activeMembership.status)}>
                                    {activeMembership.membership_plans?.name || 'Plan'}
                                  </Badge>
                                  {activeMembership.status === 'frozen' && (<Badge variant="outline" className="bg-info/10 text-info border-info/20 text-xs">
                                      <Snowflake className="h-3 w-3 mr-0.5"/>Frozen
                                    </Badge>)}
                                  {duesByMember[member.id] > 0 && (<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                                      Due ₹{duesByMember[member.id].toLocaleString()}
                                    </Badge>)}
                                </div>) : member.scheduledMembership ? (<div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge className="bg-indigo-600 text-white hover:bg-indigo-600">
                                    {member.scheduledMembership.membership_plans?.name || 'Plan'}
                                  </Badge>
                                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30 text-xs gap-1">
                                    <CalendarClock className="h-3 w-3"/>
                                    Starts {format(new Date(member.scheduledMembership.start_date), 'dd MMM yyyy')}
                                  </Badge>
                                  {duesByMember[member.id] > 0 && (<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                                      Due ₹{duesByMember[member.id].toLocaleString()}
                                    </Badge>)}
                                </div>) : (<div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge variant="outline" className="text-muted-foreground border-dashed">
                                    No Plan
                                  </Badge>
                                  {duesByMember[member.id] > 0 && (<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                                      Due ₹{duesByMember[member.id].toLocaleString()}
                                    </Badge>)}
                                </div>)}
                            </TableCell>
                            <TableCell>
                              {daysLeft !== null ? (<div className="flex flex-col gap-1">
                                  <div className={`flex items-center gap-1.5 ${getDaysLeftColor(daysLeft)}`}>
                                    {getDaysLeftIcon(daysLeft)}
                                    <span className="font-medium">{daysLeft > 0 ? `${daysLeft}d` : 'Expired'}</span>
                                  </div>
                                  {activeMembership?.id && freeDaysByMembership[activeMembership.id] > 0 && (<Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="outline" className="bg-warning/15 text-warning border-warning/40 text-[10px] w-fit gap-1">
                                          <Gift className="h-3 w-3"/>
                                          +{freeDaysByMembership[activeMembership.id]}d gift
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>Includes gifted free days</TooltipContent>
                                    </Tooltip>)}
                                </div>) : member.scheduledMembership ? (<div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
                                  <CalendarClock className="h-3 w-3"/>
                                  <span className="font-medium">
                                    Starts in {Math.max(0, differenceInDays(new Date(member.scheduledMembership.start_date), new Date()))}d
                                  </span>
                                </div>) : (<span className="text-muted-foreground">--</span>)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              <div className="flex flex-col gap-1">
                                <span>{member.joined_at && !isNaN(new Date(member.joined_at).getTime()) ? format(new Date(member.joined_at), 'dd MMM yy') : '--'}</span>
                                {(() => {
                        if (!activeMembership?.start_date)
                            return null;
                        const start = new Date(activeMembership.start_date);
                        start.setHours(0, 0, 0, 0);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        if (start <= today)
                            return null;
                        return (<Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-[10px] w-fit gap-1">
                                      <Clock className="h-3 w-3"/>
                                      Starts {format(start, 'dd MMM')}
                                    </Badge>);
                    })()}
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleViewProfile(member)}>
                                      <Eye className="h-4 w-4"/>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View Profile</TooltipContent>
                                </Tooltip>

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="icon" variant="ghost" className="h-8 w-8">
                                      <MoreHorizontal className="h-4 w-4"/>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handlePurchaseMembership(member)}>
                                      <CreditCard className="h-4 w-4 mr-2"/>
                                      {activeMembership
                        ? 'Renew Plan'
                        : scheduledMembership
                            ? 'Reschedule / Change Plan'
                            : 'Add Plan'}
                                    </DropdownMenuItem>
                                    {memberDue > 0 && (<DropdownMenuItem onClick={() => navigate(`/members/${member.id}?tab=invoices`)}>
                                        <Wallet className="h-4 w-4 mr-2 text-destructive"/>
                                        Collect Due ₹{memberDue.toLocaleString()}
                                      </DropdownMenuItem>)}
                                    {existingPlan && (<>
                                        <DropdownMenuItem onClick={() => handlePurchasePT(member)}>
                                          <Dumbbell className="h-4 w-4 mr-2"/>
                                          Buy PT Package
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => activeMembership && handleQuickFreeze(member)} disabled={!activeMembership || activeMembership.status === 'frozen'}>
                                          <Snowflake className="h-4 w-4 mr-2"/>
                                          Quick Freeze
                                          {!activeMembership && (<span className="ml-2 text-xs text-muted-foreground">(after plan starts)</span>)}
                                        </DropdownMenuItem>
                                      </>)}
                                    {member.status === 'frozen' && (<>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => {
                            const frozenMs = member.memberships?.find((ms) => ms.status === 'frozen');
                            if (frozenMs) {
                                setSelectedMember(member);
                                setSelectedMembershipForFreeze(frozenMs);
                                setQuickFreezeOpen(true);
                            }
                        }}>
                                          <Snowflake className="h-4 w-4 mr-2 text-info"/>
                                          Unfreeze Membership
                                        </DropdownMenuItem>
                                      </>)}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>);
            })}
                      {filteredMembers.length === 0 && (<TableRow>
                          <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                            {search ? 'No members found matching your search' : 'No members found'}
                          </TableCell>
                        </TableRow>)}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination Controls */}
                {totalPages !== null && totalPages > 1 && (<div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount || 0)} of {totalCount} members
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                        <ChevronLeft className="h-4 w-4 mr-1"/>
                        Previous
                      </Button>
                      <span className="text-sm font-medium px-2">
                        Page {page + 1} of {totalPages}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                        Next
                        <ChevronRight className="h-4 w-4 ml-1"/>
                      </Button>
                    </div>
                  </div>)}
              </>)}
          </CardContent>
        </Card>

        {/* Drawers */}
        <AddMemberDrawer open={addMemberOpen} onOpenChange={setAddMemberOpen} branchId={effectiveBranchId}/>

        {selectedMember && (<>
            <PurchaseMembershipDrawer open={purchaseOpen} onOpenChange={setPurchaseOpen} memberId={selectedMember.id} memberName={selectedMember.profiles?.full_name || selectedMember.member_code} branchId={selectedMember.branch_id}/>
            <PurchasePTPackageDrawer open={purchasePTOpen} onOpenChange={setPurchasePTOpen} memberId={selectedMember.id} memberName={selectedMember.profiles?.full_name || selectedMember.member_code} branchId={selectedMember.branch_id}/>
            <MemberProfileDrawer open={profileOpen} onOpenChange={handleProfileOpenChange} member={selectedMember} onPurchaseMembership={() => { setProfileOpen(false); setPurchaseOpen(true); }} onPurchasePT={() => { setProfileOpen(false); setPurchasePTOpen(true); }}/>
            {selectedMembershipForFreeze && (<QuickFreezeDrawer open={quickFreezeOpen} onOpenChange={setQuickFreezeOpen} member={selectedMember} activeMembership={selectedMembershipForFreeze} onSuccess={() => queryClient.invalidateQueries({ queryKey: ['members'] })}/>)}
          </>)}
        {effectiveBranchId && (<GroupPurchaseDrawer open={groupPurchaseOpen} onOpenChange={setGroupPurchaseOpen} branchId={effectiveBranchId}/>)}
      </div>
    </AppLayout>);
}
