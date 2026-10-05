import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getISTToday, getISTNow } from '@/lib/utils/datetime';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAttendance } from '@/hooks/useAttendance';
import { useStaffAttendance } from '@/hooks/useStaffAttendance';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Users, UserCheck, UserMinus, Clock, Search, Calendar, TrendingUp, Activity, ShieldAlert, LogIn, LogOut, History, Scan, CheckCircle, XCircle, AlertCircle, Download, DoorOpen, Info, ChevronDown, ScanFace, Layers, Flame, Sparkles, Undo2, CalendarDays } from 'lucide-react';
import { remoteOpenDoorByBranch } from '@/services/mipsService';
import { format, startOfDay, endOfDay } from 'date-fns';
import { exportToCSV } from '@/lib/csvExport';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { toast } from 'sonner';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { LivePill } from '@/components/ui/live-pill';
import { canRecordAttendanceFor } from '@/lib/auth/permissions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { notifyStaffAttendanceRecorded } from '@/lib/comms/staffAttendanceNotify';
import { PtAttendanceTabContent } from '@/components/pt/PtAttendanceTabContent';
import { Dumbbell } from 'lucide-react';

import { StaffRosterBoard } from '@/components/attendance/StaffRosterBoard';
import { StaffMonthHistory } from '@/components/attendance/StaffMonthHistory';
import { MemberAttendanceHistory } from '@/components/attendance/MemberAttendanceHistory';
import { BlockedEntryAttempts } from '@/components/attendance/BlockedEntryAttempts';
import {
  consolidateMemberAttendance,
  type ConsolidatedMemberVisit,
  type MemberAttendanceRecord,
} from '@/lib/attendance/consolidateMemberAttendance';



type FlashState = {
  type: 'success' | 'denied';
  name: string;
  message: string;
  avatar?: string;
} | null;

export default function AttendanceDashboard() {
  const { branchFilter, effectiveBranchId } = useBranchContext();
  const { hasAnyRole, user, roles } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasAnyRole(['owner', 'admin']);
  const isManager = hasAnyRole(['manager']);
  const canForceEntry = hasAnyRole(['owner', 'admin', 'manager', 'staff']);
  const canRecordStaff = hasAnyRole(['owner', 'admin', 'manager']);
  const actorRoles = (roles || []).map((r: any) => r.role);

  // Realtime: refresh on any attendance / member change.
  useRealtimeInvalidate({
    channel: 'page-attendance-dashboard',
    tables: ['member_attendance', 'staff_attendance', 'members'],
    invalidateKeys: [
      ['member-attendance-dashboard'],
      ['staff-attendance-dashboard'],
      ['staff-attendance-history'],
      ['attendance-trends'],
      ['all-staff-profiles'],
    ],
  });

  // Rapid-entry member search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [flash, setFlash] = useState<FlashState>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Dashboard state
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('members');
  const [dateFilter, setDateFilter] = useState(getISTToday());
  const [forceEntryOpen, setForceEntryOpen] = useState(false);
  const [forceEntrySearch, setForceEntrySearch] = useState('');
  const [forceEntryReason, setForceEntryReason] = useState('');
  const [forceEntrySubmitting, setForceEntrySubmitting] = useState(false);
  const [selectedForceEntryMember, setSelectedForceEntryMember] = useState<any>(null);
  const [historyMonth, setHistoryMonth] = useState(getISTToday().substring(0, 7));
  const [historyScope, setHistoryScope] = useState<'staff' | 'members'>('staff');
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  // Member attendance hook (rapid check-in)
  const {
    todayAttendance: memberTodayAttendance,
    checkedInMembers,
    checkIn,
    checkOut,
    searchMember,
    isCheckingIn,
    isCheckingOut,
    refetchToday: refetchMemberToday,
  } = useAttendance(effectiveBranchId);

  // Staff attendance hook
  const {
    todayAttendance: staffTodayAttendance,
    checkedInStaff,
    employees,
    checkIn: staffCheckIn,
    checkOut: staffCheckOut,
    isCheckingIn: isStaffCheckingIn,
    isCheckingOut: isStaffCheckingOut,
  } = useStaffAttendance(effectiveBranchId);

  // Auto-focus search bar
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Cmd+K deep-links + ?tab= deep-link from old /pt-attendance & /staff-attendance redirects
  useEffect(() => {
    const url = new URL(window.location.href);
    const tabParam = url.searchParams.get('tab');
    
    // Safety check for trainer role: if they try to access a protected tab, redirect to personal attendance
    if (actorRoles.includes('trainer') && !actorRoles.includes('staff') && !actorRoles.includes('manager') && !actorRoles.includes('admin') && !actorRoles.includes('owner')) {
      if (tabParam !== 'pt' && activeTab !== 'pt') {
        window.location.href = '/my-attendance';
        return;
      }
    }

    if (tabParam && ['members','staff-record','pt','history'].includes(tabParam)) {
      setActiveTab(tabParam);
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
    if (url.searchParams.get('force') === '1') {
      setForceEntryOpen(true);
      url.searchParams.delete('force');
      window.history.replaceState({}, '', url.toString());
    }
    if (url.searchParams.get('checkin') === '1') {
      searchInputRef.current?.focus();
      url.searchParams.delete('checkin');
      window.history.replaceState({}, '', url.toString());
    }
  }, [actorRoles, activeTab]);

  // Staff search results for top bar
  const [staffSearchResults, setStaffSearchResults] = useState<any[]>([]);

  // Auto-search with debounce (member search only — staff search moved after allStaffProfiles)
  useEffect(() => {
    if (activeTab === 'staff-record') {
      setSearchResults([]);
      return;
    }
    if (searchQuery.length >= 3) {
      const timer = setTimeout(() => handleMemberSearch(), 300);
      return () => clearTimeout(timer);
    } else if (searchQuery.length === 0) {
      setSearchResults([]);
      setStaffSearchResults([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, activeTab]);

  const showFlash = useCallback((state: FlashState) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash(state);
    flashTimerRef.current = setTimeout(() => setFlash(null), 3000);
  }, []);

  const handleMemberSearch = async () => {
    if (!searchQuery.trim() || !effectiveBranchId) return;
    setIsSearching(true);
    try {
      const results = await searchMember(searchQuery);
      setSearchResults(results || []);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && searchResults[selectedIndex]) {
        const r = searchResults[selectedIndex];
        handleQuickCheckIn(r.id, r.profiles?.full_name, r.profiles?.avatar_url);
      } else if (searchResults.length === 1) {
        handleQuickCheckIn(searchResults[0].id, searchResults[0].profiles?.full_name, searchResults[0].profiles?.avatar_url);
      } else {
        handleMemberSearch();
      }
    } else if (e.key === 'Escape') {
      setSearchResults([]);
      setSearchQuery('');
      setSelectedIndex(-1);
    }
  };

  const handleQuickCheckIn = (memberId: string, memberName?: string, avatarUrl?: string) => {
    checkIn({ memberId, method: 'manual' }, {
      onSuccess: () => {
        showFlash({
          type: 'success',
          name: memberName || 'Member',
          message: 'Check-in successful · Source: Manual',
          avatar: avatarUrl,
        });
        refetchMemberToday();
      }
    });
    setSearchResults([]);
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const handlePtAttendanceSearch = async (query: string) => {
    // If we are in the PT tab and searching, we should allow trainers/staff 
    // to quickly find their PT clients and mark session attendance.
    // This logic is handled inside PtAttendanceTabContent, which uses its own search.
    // However, the main search bar currently only targets gym check-ins.
    return;
  };


  const isAlreadyCheckedIn = (memberId: string) => {
    return checkedInMembers.data?.some((a: any) => a.member_id === memberId);
  };

  // Fetch member attendance for date
  const { data: memberAttendance = [], isLoading: memberAttendanceLoading, isError: memberAttendanceError } = useQuery({
    queryKey: ['member-attendance-dashboard', branchFilter, dateFilter],
    queryFn: async () => {
      const start = startOfDay(new Date(dateFilter)).toISOString();
      const end = endOfDay(new Date(dateFilter)).toISOString();
      let query = supabase
        .from('member_attendance')
        .select(`*, members(member_code, profiles:user_id(full_name, avatar_url))`)
        .gte('check_in', start)
        .lte('check_in', end)
        .order('check_in', { ascending: false });
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Fetch staff attendance for date
  const { data: staffAttendance = [] } = useQuery({
    queryKey: ['staff-attendance-dashboard', branchFilter, dateFilter],
    queryFn: async () => {
      const start = startOfDay(new Date(dateFilter)).toISOString();
      const end = endOfDay(new Date(dateFilter)).toISOString();
      let query = supabase
        .from('staff_attendance')
        .select(`*, profiles:user_id(full_name, email, avatar_url)`)
        .gte('check_in', start)
        .lte('check_in', end)
        .order('check_in', { ascending: false });
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // All staff profiles for manual check-in
  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles', effectiveBranchId],
    enabled: canRecordStaff && !!effectiveBranchId,
    queryFn: async () => {
      const { data: emps } = await supabase.from('employees').select('id, user_id, employee_code, position, department, weekly_off').eq('branch_id', effectiveBranchId!).eq('is_active', true);
      const { data: trainers } = await supabase.from('trainers').select('id, user_id, weekly_off').eq('branch_id', effectiveBranchId!).eq('is_active', true);
      const allUserIds = [...(emps?.map(e => e.user_id) || []), ...(trainers?.map(t => t.user_id) || [])].filter(Boolean);
      let profiles: any[] = [];
      let userRoles: any[] = [];
      if (allUserIds.length > 0) {
        const [{ data: pData }, { data: rData }] = await Promise.all([
          supabase.from('profiles').select('id, full_name, avatar_url').in('id', allUserIds),
          supabase.rpc('get_staff_roles_for_branch', { p_branch_id: effectiveBranchId! }),
        ]);
        profiles = pData || [];
        userRoles = (rData as any[]) || [];
      }
      const rolesByUser = new Map<string, string[]>();
      userRoles.forEach((r: any) => {
        const list = rolesByUser.get(r.user_id) || [];
        list.push(r.role);
        rolesByUser.set(r.user_id, list);
      });
      const empUserIds = new Set(emps?.map(e => e.user_id) || []);
      const staffList: any[] = [];
      (emps || []).forEach(emp => {
        const p = profiles.find(pr => pr.id === emp.user_id);
        const userRoleList = rolesByUser.get(emp.user_id) || [];
        const isManagerRole = userRoleList.includes('manager') || userRoleList.includes('admin') || userRoleList.includes('owner');
        const typeLabel = userRoleList.includes('owner') ? 'Owner'
          : userRoleList.includes('admin') ? 'Admin'
          : userRoleList.includes('manager') || emp.department === 'Management' ? 'Manager'
          : 'Staff';
        staffList.push({ user_id: emp.user_id, name: p?.full_name || 'Unknown', code: emp.employee_code, type: typeLabel, position: emp.position, avatar_url: p?.avatar_url, weekly_off: (emp as any).weekly_off || 'sunday', roles: userRoleList.length ? userRoleList : ['staff'] });
      });
      (trainers || []).filter(t => !empUserIds.has(t.user_id)).forEach(t => {
        const p = profiles.find(pr => pr.id === t.user_id);
        const userRoleList = rolesByUser.get(t.user_id) || ['trainer'];
        staffList.push({ user_id: t.user_id, name: p?.full_name || 'Unknown', code: 'Trainer', type: 'Trainer', position: 'Trainer', avatar_url: p?.avatar_url, weekly_off: (t as any).weekly_off || 'sunday', roles: userRoleList });
      });
      return staffList;
    },
  });

  // Staff search from top bar (after allStaffProfiles is available)
  useEffect(() => {
    if (activeTab === 'staff-record' && searchQuery.length >= 2) {
      const filtered = allStaffProfiles.filter((s: any) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.code.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setStaffSearchResults(filtered);
    } else if (activeTab === 'staff-record' && searchQuery.length === 0) {
      setStaffSearchResults([]);
    }
  }, [searchQuery, activeTab, allStaffProfiles]);

  // History data
  const { data: historyData = [] } = useQuery({
    queryKey: ['staff-attendance-history', branchFilter, historyMonth],
    queryFn: async () => {
      const start = `${historyMonth}-01T00:00:00`;
      const [year, month] = historyMonth.split('-').map(Number);
      const end = new Date(year, month, 0, 23, 59, 59, 999).toISOString();
      let query = supabase.from('staff_attendance').select(`*, profiles:user_id(full_name, email, avatar_url)`).gte('check_in', start).lte('check_in', end).order('check_in', { ascending: false });
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Weekly trends
  const { data: weeklyTrends = [] } = useQuery({
    queryKey: ['attendance-trends', branchFilter],
    queryFn: async () => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = getISTNow();
        date.setDate(date.getDate() - i);
        const start = startOfDay(date).toISOString();
        const end = endOfDay(date).toISOString();
        let mq = supabase.from('member_attendance').select('member_id').gte('check_in', start).lte('check_in', end);
        let sq = supabase.from('staff_attendance').select('id', { count: 'exact', head: true }).gte('check_in', start).lte('check_in', end);
        if (branchFilter) { mq = mq.eq('branch_id', branchFilter); sq = sq.eq('branch_id', branchFilter); }
        const [mr, sr] = await Promise.all([mq, sq]);
        days.push({ day: format(date, 'EEE'), members: new Set((mr.data || []).map((row) => row.member_id)).size, staff: sr.count || 0 });
      }
      return days;
    },
  });

  // Force entry search
  const { data: forceEntryResults = [] } = useQuery({
    queryKey: ['force-entry-search', forceEntrySearch, branchFilter],
    enabled: forceEntrySearch.length >= 2,
    queryFn: async () => {
      const { data } = await supabase.rpc('search_members', { search_term: forceEntrySearch, p_branch_id: branchFilter || null, p_limit: 10 });
      return data || [];
    },
  });

  const handleForceEntry = async () => {
    if (!selectedForceEntryMember || !branchFilter) return;
    setForceEntrySubmitting(true);
    try {
      const { data, error } = await supabase.rpc('member_force_check_in', {
        p_member_id: selectedForceEntryMember.id,
        p_branch_id: branchFilter,
        p_reason: forceEntryReason || 'Override by reception',
        p_actor_user_id: user?.id || null,
      });
      if (error) throw error;
      const result = data as { success: boolean; reason?: string; message?: string };
      if (!result?.success) throw new Error(result?.message || 'Force entry rejected');
      toast.success(`Force entry recorded for ${selectedForceEntryMember.full_name}`);
      refetchMemberToday();
      queryClient.invalidateQueries({ queryKey: ['member-attendance-dashboard'] });
      setForceEntryOpen(false);
      setForceEntrySearch('');
      setForceEntryReason('');
      setSelectedForceEntryMember(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to record force entry');
    } finally {
      setForceEntrySubmitting(false);
    }
  };

  const checkedInUserIds = new Set((checkedInStaff.data || []).map((a: any) => a.user_id));

  /**
   * Today's real attendance state per staff member.
   * A finished shift (check-in + check-out) must NOT read as "Not Checked In".
   */
  const staffTodaySummary = useMemo(() => {
    const map = new Map<string, { firstIn: string; lastOut: string | null; isLate: boolean; lateMinutes: number | null; open: boolean }>();
    for (const row of (staffTodayAttendance.data || []) as any[]) {
      if (!row?.user_id) continue;
      const existing = map.get(row.user_id);
      const open = !row.check_out;
      if (!existing) {
        map.set(row.user_id, {
          firstIn: row.check_in,
          lastOut: row.check_out ?? null,
          isLate: !!row.is_late,
          lateMinutes: row.late_minutes ?? null,
          open,
        });
      } else {
        if (new Date(row.check_in) < new Date(existing.firstIn)) {
          existing.firstIn = row.check_in;
          existing.isLate = !!row.is_late;
          existing.lateMinutes = row.late_minutes ?? null;
        }
        if (row.check_out && (!existing.lastOut || new Date(row.check_out) > new Date(existing.lastOut))) {
          existing.lastOut = row.check_out;
        }
        existing.open = existing.open || open;
      }
    }
    return map;
  }, [staffTodayAttendance.data]);

  const fmtTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '--:--';


  const decisionFor = (staff: any) =>
    canRecordAttendanceFor(actorRoles, staff?.roles, staff?.user_id === user?.id);

  const fireAttendanceNotify = (staff: any, action: 'check_in' | 'check_out') => {
    // Wired for future use — currently a no-op (flag off in staffAttendanceNotify.ts).
    // When enabled, pings the target user via WhatsApp/Email so misuse surfaces immediately.
    void notifyStaffAttendanceRecorded({
      targetUserId: staff.user_id,
      targetPhone: staff.phone || null,
      targetEmail: staff.email || null,
      action,
      actorName: (user as any)?.user_metadata?.full_name || (user as any)?.email || 'Staff member',
      occurredAt: new Date().toISOString(),
      branchId: effectiveBranchId || '',
      reason: undefined, // reason UI not yet exposed; will be plugged in when feature is enabled
    });
  };

  const handleStaffCheckIn = (staff: any) => {
    const decision = decisionFor(staff);
    if (!decision.allowed) {
      toast.error(decision.reason || 'Not allowed');
      return;
    }
    staffCheckIn({ userId: staff.user_id }, {
      onSuccess: () => {
        fireAttendanceNotify(staff, 'check_in');
      }
    });
  };

  const handleStaffCheckOut = (staff: any) => {
    const decision = decisionFor(staff);
    if (!decision.allowed) {
      toast.error(decision.reason || 'Not allowed');
      return;
    }
    staffCheckOut(staff.user_id, {
      onSuccess: () => {
        fireAttendanceNotify(staff, 'check_out');
      }
    });
  };

  const consolidatedMemberAttendance = useMemo(
    () => consolidateMemberAttendance(memberAttendance as unknown as MemberAttendanceRecord[]),
    [memberAttendance],
  );

  const presentMemberIds = useMemo(() => consolidatedMemberAttendance.map((a) => a.member_id).sort(), [consolidatedMemberAttendance]);

  // Streak + last previous visit for members seen on the selected day (IST calendar days).
  const { data: memberStreaks = {} } = useQuery({
    queryKey: ['member-attendance-streaks', branchFilter, dateFilter, presentMemberIds.join(',')],
    enabled: presentMemberIds.length > 0,
    queryFn: async () => {
      const istKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
      const end = endOfDay(new Date(dateFilter));
      const from = new Date(end.getTime() - 90 * 86400000).toISOString();
      const { data, error } = await supabase.from('member_attendance').select('member_id, check_in')
        .in('member_id', presentMemberIds).gte('check_in', from).lte('check_in', end.toISOString()).limit(5000);
      if (error) throw error;
      const days = new Map<string, Set<string>>();
      for (const r of data ?? []) {
        const set = days.get(r.member_id) ?? new Set<string>();
        set.add(istKey(new Date(r.check_in)));
        days.set(r.member_id, set);
      }
      const result: Record<string, { streak: number; gapDays: number | null; lastVisit: string | null }> = {};
      for (const id of presentMemberIds) {
        const set = days.get(id) ?? new Set<string>();
        let streak = 0;
        const cursor = new Date(`${dateFilter}T00:00:00Z`);
        while (set.has(cursor.toISOString().slice(0, 10))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
        const prior = [...set].filter((k) => k < dateFilter).sort().pop() ?? null;
        const gapDays = prior ? Math.round((new Date(`${dateFilter}T00:00:00Z`).getTime() - new Date(`${prior}T00:00:00Z`).getTime()) / 86400000) : null;
        result[id] = { streak, gapDays, lastVisit: prior };
      }
      return result;
    },
  });

  // Active members not seen for 3+ days (gate scans included server-side).
  const { data: absentMembers = [], isLoading: absentLoading, isError: absentError } = useQuery({
    queryKey: ['attendance-absent-members', effectiveBranchId],
    enabled: !!effectiveBranchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inactive_members', { p_branch_id: effectiveBranchId!, p_days: 3, p_limit: 200 });
      if (error) throw error;
      return (data ?? []) as { member_id: string; member_code: string | null; full_name: string; avatar_url: string | null; last_visit: string | null; days_absent: number }[];
    },
  });

  const filteredAbsentMembers = absentMembers.filter((m) => `${m.full_name} ${m.member_code ?? ''}`.toLowerCase().includes(searchTerm.toLowerCase()));

  const filteredMemberAttendance = consolidatedMemberAttendance.filter((a) => {
    const name = a.members?.profiles?.full_name || '';
    const code = a.members?.member_code || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase()) || code.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const filteredStaffAttendance = staffAttendance.filter((a: any) => {
    const name = a.profiles?.full_name || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const stats = {
    totalMemberCheckIns: consolidatedMemberAttendance.length,
    activeMemberCheckIns: consolidatedMemberAttendance.filter((a) => a.isActive).length,
    totalStaffCheckIns: staffAttendance.length,
    activeStaffCheckIns: staffAttendance.filter((a: any) => !a.check_out).length,
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const formatDuration = (checkIn: string, checkOut: string | null) => {
    if (!checkOut) return 'Active';
    const duration = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000;
    const hours = Math.floor(duration / 60);
    const mins = Math.round(duration % 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const getSourceBadge = (att: ConsolidatedMemberVisit | MemberAttendanceRecord) => {
    const method = 'sourceLabel' in att ? att.sourceLabel : att.check_in_method || att.source || 'manual';
    const base = 'gap-1 rounded-full border text-xs font-medium';
    if (method === 'force_entry') return <Badge variant="outline" className={`${base} bg-amber-50 text-amber-700 border-amber-200`}><ShieldAlert className="h-3 w-3" />Force</Badge>;
    if (method === 'device' || method === 'biometric') return <Badge variant="outline" className={`${base} bg-violet-50 text-violet-700 border-violet-200`}><ScanFace className="h-3 w-3" />Face gate</Badge>;
    if (method === 'mixed') return <Badge variant="outline" className={`${base} bg-indigo-50 text-indigo-700 border-indigo-200`}><Layers className="h-3 w-3" />Mixed</Badge>;
    return <Badge variant="outline" className={`${base} bg-blue-50 text-blue-700 border-blue-200`}><UserCheck className="h-3 w-3" />Front desk</Badge>;
  };

  const getStatusBadge = (att: ConsolidatedMemberVisit) => att.isActive
    ? <Badge className="gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>In gym</Badge>
    : <Badge className="gap-1 rounded-full border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100"><CheckCircle className="h-3 w-3" />Completed</Badge>;

  const getStreakBadge = (memberId: string) => {
    const s = memberStreaks[memberId];
    if (!s) return null;
    if (s.streak >= 2) return <Badge className="gap-1 rounded-full border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50"><Flame className="h-3 w-3" />{s.streak}-day streak</Badge>;
    if (s.gapDays === null) return <Badge className="gap-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><Sparkles className="h-3 w-3" />First visit</Badge>;
    if (s.gapDays >= 5) return <Badge className="gap-1 rounded-full border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50"><Undo2 className="h-3 w-3" />Back after {s.gapDays}d</Badge>;
    return <Badge className="gap-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-50"><CalendarDays className="h-3 w-3" />Last {format(new Date(s.lastVisit!), 'dd MMM')}</Badge>;
  };

  const absenceBadge = (days: number) => {
    const cls = days >= 14 ? 'border-red-200 bg-red-50 text-red-700' : days >= 7 ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-amber-200 bg-amber-50 text-amber-700';
    return <Badge className={`rounded-full border ${cls} hover:bg-transparent`}>{days}d absent</Badge>;
  };

  // History: per-staff summary. "Days elapsed" only counts days that have actually
  // happened in the selected month, so a mid-month view never reads as mass absence.
  const historyStaffSummary = (() => {
    const [year, month] = historyMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
    const elapsedDays = isCurrentMonth
      ? Math.min(now.getDate(), daysInMonth)
      : (new Date(year, month - 1, 1) > now ? 0 : daysInMonth);

    type Row = { name: string; email: string; dayKeys: Set<string>; totalHours: number; openShifts: number };
    const map = new Map<string, Row>();

    // Seed from allStaffProfiles
    allStaffProfiles.forEach((s: any) => {
      map.set(s.user_id, { name: s.name, email: '', dayKeys: new Set(), totalHours: 0, openShifts: 0 });
    });

    historyData.forEach((r: any) => {
      const key = r.user_id;
      const existing = map.get(key) || { name: r.profiles?.full_name || 'Unknown', email: r.profiles?.email || '', dayKeys: new Set<string>(), totalHours: 0, openShifts: 0 };
      existing.name = existing.name || r.profiles?.full_name || 'Unknown';
      existing.email = r.profiles?.email || existing.email;
      existing.dayKeys.add(r.shift_date || format(new Date(r.check_in), 'yyyy-MM-dd'));
      if (r.check_in && r.check_out) {
        existing.totalHours += (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 3600000;
      } else {
        existing.openShifts += 1;
      }
      map.set(key, existing);
    });

    return Array.from(map.entries()).map(([userId, data]) => {
      const days = data.dayKeys.size;
      return {
        userId,
        name: data.name,
        email: data.email,
        days,
        totalHours: data.totalHours,
        openShifts: data.openShifts,
        elapsedDays,
        totalDays: daysInMonth,
        missedDays: Math.max(elapsedDays - days, 0),
      };
    }).filter(s => s.days > 0 || allStaffProfiles.some((p: any) => p.user_id === s.userId));
  })();

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Attendance Command Center</h1>
                <LivePill />
              </div>
              <p className="text-sm text-muted-foreground">Unified member & staff attendance</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && canForceEntry && (
              <Button variant="outline" className="gap-2 border-warning text-warning hover:bg-warning/10" onClick={() => setForceEntryOpen(true)}>
                <ShieldAlert className="h-4 w-4" />
                Force Entry
              </Button>
            )}
            {isAdmin && effectiveBranchId && (
              <Button
                variant="outline"
                className="gap-2 border-primary text-primary hover:bg-primary/10"
                onClick={async () => {
                  const t = toast.loading('Opening entry doors...');
                  const result = await remoteOpenDoorByBranch(effectiveBranchId, { role: 'entry' });
                  toast.dismiss(t);
                  const detail = (result.attempts || []).map(a =>
                    `${a.device_name}: ${a.success ? '✓' : '✗'} ${a.latency_ms}ms${a.success ? '' : ` — ${a.message}`}`
                  ).join('\n');
                  if (result.success) toast.success(result.message, { description: detail || undefined });
                  else toast.error(result.message, { description: detail || undefined });
                }}
              >
                <DoorOpen className="h-4 w-4" />
                Override Entry
              </Button>
            )}

            <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-[150px] sm:w-[180px]" />
            <div className="hidden md:flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                <span className="font-semibold text-primary">{stats.activeMemberCheckIns + stats.activeStaffCheckIns}</span>
                <span className="text-muted-foreground">Active</span>
              </div>
              <div className="flex items-center gap-1.5">
                <LogIn className="h-3.5 w-3.5 text-success" />
                <span className="font-semibold">{stats.totalMemberCheckIns + stats.totalStaffCheckIns}</span>
                <span className="text-muted-foreground">Today</span>
              </div>
            </div>
          </div>
        </div>

        {/* Flash Banner */}
        {flash && (
          <div className={`flex items-center gap-4 p-5 rounded-xl border-2 animate-in slide-in-from-top-2 duration-300 ${flash.type === 'success' ? 'bg-success/10 border-success/40 text-success' : 'bg-destructive/10 border-destructive/40 text-destructive'}`}>
            {flash.type === 'success' ? <CheckCircle className="h-10 w-10 flex-shrink-0" /> : <XCircle className="h-10 w-10 flex-shrink-0" />}
            {flash.avatar && (
              <Avatar className="h-14 w-14 ring-2 ring-success/30">
                <AvatarImage src={flash.avatar} />
                <AvatarFallback className="text-lg font-bold">{flash.name.charAt(0)}</AvatarFallback>
              </Avatar>
            )}
            <div>
              <p className="font-bold text-xl">{flash.name}</p>
              <p className="text-sm opacity-80">{flash.message}</p>
            </div>
          </div>
        )}

        {/* Rapid-Entry Search Bar (Management Roles Only) */}
        {hasAnyRole(['owner', 'admin', 'manager', 'staff']) && (
          <div className="space-y-2">
          <div className="flex gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Scan className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder={
                  activeTab === 'pt' 
                    ? "Search PT Client..." 
                    : activeTab === 'staff-record' 
                      ? "Search staff by name or employee code…" 
                      : "Scan barcode or type member code / name / phone…"
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="h-14 min-w-0 pl-12 text-base transition-colors focus:border-primary sm:text-lg"
              />
            </div>
            <Button onClick={handleMemberSearch} disabled={isSearching || activeTab === 'staff-record'} className="h-14 shrink-0 px-4 sm:px-6" size="lg">
              <Search className="h-5 w-5 sm:mr-2" />
              <span className="hidden sm:inline">{isSearching ? 'Searching…' : 'Search'}</span>
            </Button>
          </div>
        </div>
        )}

        {/* Staff Search Results from top bar */}
        {activeTab === 'staff-record' && staffSearchResults.length > 0 && searchQuery.length >= 2 && (
          <div className="space-y-2">
            {staffSearchResults.map((staff: any) => {
              const isCheckedIn = checkedInUserIds.has(staff.user_id);
              const decision = decisionFor(staff);
              return (
                <div key={staff.user_id} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${isCheckedIn ? 'bg-success/5 border-success/30' : 'bg-card border-border hover:border-primary/50 hover:shadow-md'}`}>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12 ring-2 ring-background shadow">
                      <AvatarImage src={staff.avatar_url} />
                      <AvatarFallback className="bg-accent/10 text-accent font-semibold">{getInitials(staff.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-lg">{staff.name}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <code className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{staff.code}</code>
                        <Badge className={`border text-xs ${staff.type === 'Trainer' ? 'bg-info/10 text-info border-info/20' : 'bg-muted text-muted-foreground border-border'}`}>{staff.type}</Badge>
                      </div>
                      {!decision.allowed && (
                        <p className="text-xs text-warning mt-1">{decision.reason}</p>
                      )}
                    </div>
                  </div>
                  {isCheckedIn ? (
                    <Button size="lg" variant="outline" className="gap-2" disabled={isStaffCheckingOut || !decision.allowed} onClick={() => handleStaffCheckOut(staff)}>
                      <LogOut className="w-5 h-5" /> Check Out
                    </Button>
                  ) : (
                    <Button size="lg" className="gap-2 bg-success hover:bg-success/90 text-success-foreground" disabled={isStaffCheckingIn || !decision.allowed} onClick={() => handleStaffCheckIn(staff)}>
                      <LogIn className="w-5 h-5" /> Check In
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="space-y-2">
            {searchResults.map((member) => {
              const alreadyIn = isAlreadyCheckedIn(member.id);
              return (
                <div key={member.id} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${alreadyIn ? 'bg-warning/5 border-warning/30' : 'bg-card border-border hover:border-primary/50 hover:shadow-md'}`}>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12 ring-2 ring-background shadow">
                      <AvatarImage src={member.profiles?.avatar_url} />
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">{member.profiles?.full_name?.charAt(0) || 'M'}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-lg">{member.profiles?.full_name || 'Unknown'}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <code className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{member.member_code}</code>
                        {member.profiles?.phone && <span>{member.profiles.phone}</span>}
                      </div>
                    </div>
                  </div>
                  {alreadyIn ? (
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        checkOut(member.id, {
                          onSuccess: () => {
                            setSearchResults(prev => prev.filter(m => m.id !== member.id));
                            refetchMemberToday();
                          }
                        });
                      }} 
                      disabled={isCheckingOut} 
                      size="lg" 
                      className="gap-2 border-warning text-warning hover:bg-warning/10"
                    >
                      <LogOut className="w-5 h-5" />
                      {isCheckingOut ? 'Checking Out...' : 'Check Out'}
                    </Button>
                  ) : (
                    <Button onClick={() => handleQuickCheckIn(member.id, member.profiles?.full_name, member.profiles?.avatar_url)} disabled={isCheckingIn} size="lg" className="gap-2">
                      <UserCheck className="w-5 h-5" />
                      Check In
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab !== 'staff-record' && searchQuery.length >= 3 && searchResults.length === 0 && !isSearching && (
          <div className="text-center py-8 text-muted-foreground">
            <div className="h-14 w-14 rounded-full bg-muted/80 flex items-center justify-center mx-auto mb-3">
              <Search className="h-6 w-6 opacity-40" />
            </div>
            <p className="font-medium text-foreground/70">No members found</p>
            <p className="text-sm mt-1">No results for "{searchQuery}" — try a different name, code, or phone number</p>
          </div>
        )}

        {activeTab === 'staff-record' && searchQuery.length >= 2 && staffSearchResults.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <div className="h-14 w-14 rounded-full bg-muted/80 flex items-center justify-center mx-auto mb-3">
              <Search className="h-6 w-6 opacity-40" />
            </div>
            <p className="font-medium text-foreground/70">No staff found</p>
            <p className="text-sm mt-1">No staff matched "{searchQuery}" — try another name or employee code</p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Card className="rounded-2xl border-0 bg-gradient-to-br from-accent to-accent/80 text-accent-foreground shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Member Check-ins</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.totalMemberCheckIns}</h3>
                  <p className="text-xs opacity-70 mt-1">{stats.activeMemberCheckIns} active</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center"><Users className="h-6 w-6" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-0 bg-gradient-to-br from-success to-success/80 text-success-foreground shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Staff Check-ins</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.totalStaffCheckIns}</h3>
                  <p className="text-xs opacity-70 mt-1">{stats.activeStaffCheckIns} active</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center"><UserCheck className="h-6 w-6" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-0 bg-gradient-to-br from-info to-info/80 text-info-foreground shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Currently Active</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.activeMemberCheckIns + stats.activeStaffCheckIns}</h3>
                  <p className="text-xs opacity-70 mt-1">In gym right now</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center"><Clock className="h-6 w-6" /></div>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Total Today</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.totalMemberCheckIns + stats.totalStaffCheckIns}</h3>
                  <p className="text-xs opacity-70 mt-1">All check-ins</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center"><TrendingUp className="h-6 w-6" /></div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Weekly Trend</CardTitle><CardDescription>Last 7 days</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={weeklyTrends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Line type="monotone" dataKey="members" stroke="hsl(var(--accent))" strokeWidth={2} name="Members" />
                  <Line type="monotone" dataKey="staff" stroke="hsl(var(--success))" strokeWidth={2} name="Staff" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Daily Comparison</CardTitle><CardDescription>Members vs Staff</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={weeklyTrends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="members" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} name="Members" />
                  <Bar dataKey="staff" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Staff" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle>Attendance Management</CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                    const exportData = filteredMemberAttendance.map((a) => ({
                    Name: a.members?.profiles?.full_name || 'Unknown',
                    Code: a.members?.member_code || '',
                      'First Check In': format(new Date(a.firstCheckIn), 'yyyy-MM-dd HH:mm'),
                      'Last Check Out': a.lastCheckOut ? format(new Date(a.lastCheckOut), 'yyyy-MM-dd HH:mm') : '',
                      Duration: formatDuration(a.firstCheckIn, a.lastCheckOut),
                      Entries: a.scanCount,
                      Source: a.sourceLabel,
                  }));
                  exportToCSV(exportData, `attendance_${activeTab}_${dateFilter}`);
                }}>
                  <Download className="h-4 w-4" /> Export
                </Button>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filter..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-muted/50 rounded-xl p-1 h-auto flex-wrap mb-4">
                {hasAnyRole(['owner', 'admin', 'manager', 'staff']) && (
                  <TabsTrigger value="members" className="rounded-lg gap-2 data-[state=active]:shadow-md py-2">
                    <Users className="h-3.5 w-3.5" />Members
                  </TabsTrigger>
                )}
                <TabsTrigger value="pt" className="rounded-lg gap-2 data-[state=active]:shadow-md py-2">
                  <Dumbbell className="h-3.5 w-3.5" />PT Clients
                </TabsTrigger>
                {hasAnyRole(['owner', 'admin', 'manager']) && (
                  <TabsTrigger value="staff-record" className="rounded-lg gap-2 data-[state=active]:shadow-md py-2">
                    <UserCheck className="h-3.5 w-3.5" />Record Staff
                  </TabsTrigger>
                )}
                {hasAnyRole(['owner', 'admin', 'manager', 'staff']) && (
                  <>
                    <TabsTrigger value="blocked" className="rounded-lg gap-2 data-[state=active]:shadow-md py-2">
                      <ShieldAlert className="h-3.5 w-3.5" />Refused Entries
                    </TabsTrigger>
                    <TabsTrigger value="history" className="rounded-lg gap-2 data-[state=active]:shadow-md py-2">
                      <History className="h-3.5 w-3.5" />History
                    </TabsTrigger>
                  </>
                )}

              </TabsList>

              {/* PT Sessions Tab */}
              <TabsContent value="pt">
                <PtAttendanceTabContent />
              </TabsContent>

              {/* Members Tab */}
              <TabsContent value="members">
                <div className="mb-4 flex items-start gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <p><span className="font-semibold text-foreground">One row per person.</span> Repeat gate scans are grouped into one daily visit; expand a row to review every entry.</p>
                </div>
                {/* Bulk Check-out */}
                {filteredMemberAttendance.some((a) => a.isActive) && (
                  <div className="flex justify-end mb-4">
                    <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                      const activeIds = [...new Set(filteredMemberAttendance.filter((a) => a.isActive).map((a) => a.member_id))];
                      let count = 0;
                      for (const mid of activeIds) {
                        try { 
                          await new Promise((resolve, reject) => {
                            checkOut(mid, { onSuccess: resolve, onError: reject });
                          });
                          count++; 
                        } catch {}
                      }
                      refetchMemberToday();
                      toast.success(`Checked out ${count} member(s)`);
                    }}>
                      <LogOut className="h-4 w-4" />
                      Bulk Check Out ({filteredMemberAttendance.filter((a) => a.isActive).length})
                    </Button>
                  </div>
                )}
                <div className="hidden overflow-hidden rounded-xl md:block"><Table>
                  <TableHeader>
                    <TableRow className="sticky top-0 z-10 bg-card hover:bg-card">
                      <TableHead>Member</TableHead>
                      <TableHead>First in</TableHead>
                      <TableHead>Last out</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberAttendanceLoading ? [0, 1, 2, 3].map((item) => (
                      <TableRow key={item}><TableCell colSpan={6}><Skeleton className="h-12 w-full rounded-xl" /></TableCell></TableRow>
                    )) : memberAttendanceError ? (
                      <TableRow><TableCell colSpan={6} className="py-12 text-center text-destructive">Could not load member attendance.</TableCell></TableRow>
                    ) : filteredMemberAttendance.map((attendance) => (
                      <Fragment key={attendance.id}>
                      <TableRow className="transition-colors duration-150 hover:bg-slate-50">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={attendance.members?.profiles?.avatar_url} />
                              <AvatarFallback className="bg-accent/10 text-accent text-xs">{getInitials(attendance.members?.profiles?.full_name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{attendance.members?.profiles?.full_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{attendance.members?.member_code}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{fmtTime(attendance.firstCheckIn)}</TableCell>
                        <TableCell>{attendance.lastCheckOut ? fmtTime(attendance.lastCheckOut) : '—'}</TableCell>
                        <TableCell>{attendance.isActive ? 'Active' : formatDuration(attendance.firstCheckIn, attendance.lastCheckOut)}</TableCell>
                        <TableCell><div className="flex items-center gap-2">{getSourceBadge(attendance)}{attendance.scanCount > 1 && <Badge variant="secondary" className="rounded-full">{attendance.scanCount} entries</Badge>}</div></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {attendance.isActive ? <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" disabled={isCheckingOut} onClick={() => checkOut(attendance.member_id, { onSuccess: () => refetchMemberToday() })}><LogOut className="h-3.5 w-3.5" /> Check Out</Button> : <Badge className="rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Completed</Badge>}
                            {attendance.scanCount > 1 && <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Show ${attendance.scanCount} entries for ${attendance.members?.profiles?.full_name || 'member'}`} onClick={() => setExpandedMemberId(expandedMemberId === attendance.member_id ? null : attendance.member_id)}><ChevronDown className={`h-4 w-4 transition-transform ${expandedMemberId === attendance.member_id ? 'rotate-180' : ''}`} /></Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedMemberId === attendance.member_id && attendance.scanCount > 1 && <TableRow key={`${attendance.id}-details`} className="bg-muted/30 hover:bg-muted/30"><TableCell colSpan={6} className="px-6 py-4"><div className="ml-12 grid gap-2 lg:grid-cols-3">{attendance.entries.map((entry, index) => <div key={entry.id} className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs shadow-sm"><span className="font-semibold">Entry {index + 1}</span><span className="text-muted-foreground">{fmtTime(entry.check_in)} – {entry.check_out ? fmtTime(entry.check_out) : 'Active'}</span>{getSourceBadge(entry)}</div>)}</div></TableCell></TableRow>}
                      </Fragment>
                    ))}
                    {!memberAttendanceLoading && !memberAttendanceError && filteredMemberAttendance.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No member attendance records</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table></div>
                <div className="space-y-3 md:hidden">
                  {memberAttendanceLoading ? [0, 1, 2].map((item) => <Skeleton key={item} className="h-36 w-full rounded-2xl" />) : memberAttendanceError ? <p className="py-10 text-center text-sm text-destructive">Could not load member attendance.</p> : filteredMemberAttendance.map((attendance) => (
                    <div key={attendance.id} className="rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50">
                      <div className="flex items-start gap-3"><Avatar className="h-11 w-11"><AvatarImage src={attendance.members?.profiles?.avatar_url} /><AvatarFallback className="bg-accent/10 text-accent text-xs">{getInitials(attendance.members?.profiles?.full_name)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{attendance.members?.profiles?.full_name || 'Unknown'}</p><p className="text-xs text-muted-foreground">{attendance.members?.member_code}</p></div>{attendance.isActive ? <Badge className="rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge> : <Badge className="rounded-full bg-slate-100 text-slate-600 hover:bg-slate-100">Completed</Badge>}</div>
                      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center"><div><p className="text-[11px] text-muted-foreground">First in</p><p className="mt-1 text-sm font-semibold">{fmtTime(attendance.firstCheckIn)}</p></div><div><p className="text-[11px] text-muted-foreground">Last out</p><p className="mt-1 text-sm font-semibold">{attendance.lastCheckOut ? fmtTime(attendance.lastCheckOut) : '—'}</p></div><div><p className="text-[11px] text-muted-foreground">Duration</p><p className="mt-1 text-sm font-semibold">{attendance.isActive ? 'Active' : formatDuration(attendance.firstCheckIn, attendance.lastCheckOut)}</p></div></div>
                      <div className="mt-3 flex min-h-11 items-center justify-between gap-2"><div className="flex items-center gap-2">{getSourceBadge(attendance)}{attendance.scanCount > 1 && <Badge variant="secondary" className="rounded-full">{attendance.scanCount} entries</Badge>}</div>{attendance.isActive ? <Button variant="outline" size="sm" className="min-h-11 gap-1.5" disabled={isCheckingOut} onClick={() => checkOut(attendance.member_id, { onSuccess: () => refetchMemberToday() })}><LogOut className="h-4 w-4" />Check Out</Button> : attendance.scanCount > 1 ? <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Show ${attendance.scanCount} entries`} onClick={() => setExpandedMemberId(expandedMemberId === attendance.member_id ? null : attendance.member_id)}><ChevronDown className={`h-4 w-4 transition-transform ${expandedMemberId === attendance.member_id ? 'rotate-180' : ''}`} /></Button> : null}</div>
                      {expandedMemberId === attendance.member_id && attendance.scanCount > 1 && <div className="mt-3 space-y-2 border-t border-border/60 pt-3">{attendance.entries.map((entry, index) => <div key={entry.id} className="flex items-center justify-between text-xs"><span className="font-medium">Entry {index + 1}</span><span className="text-muted-foreground">{fmtTime(entry.check_in)} – {entry.check_out ? fmtTime(entry.check_out) : 'Active'}</span></div>)}</div>}
                    </div>
                  ))}
                  {!memberAttendanceLoading && !memberAttendanceError && filteredMemberAttendance.length === 0 && <div className="py-12 text-center"><Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="text-sm font-medium">No member attendance records</p><p className="mt-1 text-xs text-muted-foreground">Check-ins for this date will appear here.</p></div>}
                </div>
              </TabsContent>

              {/* Staff Check-in Tab — dual-shift roster board */}
              <TabsContent value="staff-record">
                {!canRecordStaff ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShieldAlert className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Only admins and managers can record staff attendance</p>
                  </div>
                ) : (
                  <StaffRosterBoard
                    branchId={effectiveBranchId}
                    canManage={canRecordStaff}
                    currentUserId={user?.id}
                  />
                )}
              </TabsContent>




              {/* History Tab — staff (block accurate) + members */}
              <TabsContent value="history">
                <div className="space-y-4">
                  <div className="inline-flex rounded-full bg-muted p-1">
                    {([
                      { key: 'staff', label: 'Staff' },
                      { key: 'members', label: 'Members' },
                    ] as const).map((seg) => (
                      <button
                        key={seg.key}
                        type="button"
                        onClick={() => setHistoryScope(seg.key)}
                        className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${
                          historyScope === seg.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {seg.label}
                      </button>
                    ))}
                  </div>

                  {historyScope === 'staff' ? (
                    canRecordStaff ? (
                      <StaffMonthHistory branchId={effectiveBranchId} />
                    ) : (
                      <div className="py-12 text-center text-muted-foreground">
                        <ShieldAlert className="mx-auto mb-4 h-12 w-12 opacity-50" />
                        <p>Only admins and managers can view staff attendance history</p>
                      </div>
                    )
                  ) : (
                    <MemberAttendanceHistory branchId={effectiveBranchId} />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="blocked" className="mt-6">
                <BlockedEntryAttempts
                  branchId={effectiveBranchId}
                  from={`${dateFilter}T00:00:00`}
                  to={`${dateFilter}T23:59:59.999`}
                  showMemberColumn
                  title="Refused entries"
                  description="People who came to the club on this date but the gate turned away."
                />

              </TabsContent>

            </Tabs>
          </CardContent>
        </Card>

        {/* Force Entry Drawer */}
        <Sheet open={forceEntryOpen} onOpenChange={setForceEntryOpen}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-warning" />Force Entry</SheetTitle>
              <SheetDescription>Override membership validation for special cases. This action is audited.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div className="space-y-2">
                <Label>Search Member</Label>
                <Input placeholder="Name, phone, or member code..." value={forceEntrySearch} onChange={(e) => { setForceEntrySearch(e.target.value); setSelectedForceEntryMember(null); }} />
              </div>
              {forceEntryResults.length > 0 && !selectedForceEntryMember && (
                <div className="space-y-1 max-h-48 overflow-auto border rounded-lg">
                  {forceEntryResults.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer" onClick={() => { setSelectedForceEntryMember(m); setForceEntrySearch(m.full_name || m.member_code); }}>
                      <div>
                        <p className="font-medium">{m.full_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">{m.member_code} · {m.phone}</p>
                      </div>
                      <Badge variant={m.member_status === 'active' ? 'default' : 'destructive'}>{m.member_status}</Badge>
                    </div>
                  ))}
                </div>
              )}
              {selectedForceEntryMember && (
                <div className="p-3 border rounded-lg bg-warning/5 border-warning/30">
                  <p className="font-medium">{selectedForceEntryMember.full_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedForceEntryMember.member_code} · Status: {selectedForceEntryMember.member_status}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Reason for Force Entry *</Label>
                <Textarea placeholder="e.g., Payment pending, guest pass, trial..." value={forceEntryReason} onChange={(e) => setForceEntryReason(e.target.value)} rows={3} />
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setForceEntryOpen(false)}>Cancel</Button>
                <Button className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={handleForceEntry} disabled={forceEntrySubmitting || !selectedForceEntryMember || !forceEntryReason.trim()}>
                  {forceEntrySubmitting ? 'Recording...' : 'Record Force Entry'}
                </Button>
              </SheetFooter>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </AppLayout>
  );
}
