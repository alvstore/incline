import { useState, useEffect, useRef, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
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
import { Users, UserCheck, UserMinus, Clock, Search, Calendar, TrendingUp, Activity, ShieldAlert, LogIn, LogOut, History, Scan, CheckCircle, XCircle, AlertCircle, Download, DoorOpen, Info } from 'lucide-react';
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
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [forceEntryOpen, setForceEntryOpen] = useState(false);
  const [forceEntrySearch, setForceEntrySearch] = useState('');
  const [forceEntryReason, setForceEntryReason] = useState('');
  const [forceEntrySubmitting, setForceEntrySubmitting] = useState(false);
  const [selectedForceEntryMember, setSelectedForceEntryMember] = useState<any>(null);
  const [historyMonth, setHistoryMonth] = useState(format(new Date(), 'yyyy-MM'));

  // Member attendance hook (rapid check-in)
  const {
    todayAttendance: memberTodayAttendance,
    checkedInMembers,
    checkIn,
    checkOut,
    searchMember,
    isCheckingIn,
    isCheckingOut,
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

  // Cmd+K deep-links
  useEffect(() => {
    const url = new URL(window.location.href);
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
  }, []);

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
    checkIn({ memberId, method: 'manual' });
    showFlash({
      type: 'success',
      name: memberName || 'Member',
      message: 'Check-in successful · Source: Manual',
      avatar: avatarUrl,
    });
    setSearchResults([]);
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const isAlreadyCheckedIn = (memberId: string) => {
    return checkedInMembers.data?.some((a: any) => a.member_id === memberId);
  };

  // Fetch member attendance for date
  const { data: memberAttendance = [] } = useQuery({
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
      const end = new Date(year, month, 0).toISOString();
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
        const date = new Date();
        date.setDate(date.getDate() - i);
        const start = startOfDay(date).toISOString();
        const end = endOfDay(date).toISOString();
        let mq = supabase.from('member_attendance').select('id', { count: 'exact', head: true }).gte('check_in', start).lte('check_in', end);
        let sq = supabase.from('staff_attendance').select('id', { count: 'exact', head: true }).gte('check_in', start).lte('check_in', end);
        if (branchFilter) { mq = mq.eq('branch_id', branchFilter); sq = sq.eq('branch_id', branchFilter); }
        const [mr, sr] = await Promise.all([mq, sq]);
        days.push({ day: format(date, 'EEE'), members: mr.count || 0, staff: sr.count || 0 });
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
      queryClient.invalidateQueries({ queryKey: ['member-attendance-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
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
    staffCheckIn({ userId: staff.user_id });
    fireAttendanceNotify(staff, 'check_in');
  };

  const handleStaffCheckOut = (staff: any) => {
    const decision = decisionFor(staff);
    if (!decision.allowed) {
      toast.error(decision.reason || 'Not allowed');
      return;
    }
    staffCheckOut(staff.user_id);
    fireAttendanceNotify(staff, 'check_out');
  };

  const filteredMemberAttendance = memberAttendance.filter((a: any) => {
    const name = a.members?.profiles?.full_name || '';
    const code = a.members?.member_code || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase()) || code.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const filteredStaffAttendance = staffAttendance.filter((a: any) => {
    const name = a.profiles?.full_name || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const stats = {
    totalMemberCheckIns: memberAttendance.length,
    activeMemberCheckIns: memberAttendance.filter((a: any) => !a.check_out).length,
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
    return `${hours}h ${mins}m`;
  };

  const getSourceBadge = (att: any) => {
    const method = att.check_in_method || att.source || 'manual';
    if (method === 'force_entry') return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs"><ShieldAlert className="h-3 w-3 mr-0.5" />Force</Badge>;
    if (method === 'device' || method === 'biometric') return <Badge variant="outline" className="bg-info/10 text-info border-info/20 text-xs">Device</Badge>;
    return <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">Manual</Badge>;
  };

  // History: per-staff summary (actual attendance days vs calendar days)
  const historyStaffSummary = (() => {
    const [year, month] = historyMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    const map = new Map<string, { name: string; email: string; days: number; totalHours: number }>();
    
    // Seed from allStaffProfiles
    allStaffProfiles.forEach((s: any) => {
      map.set(s.user_id, { name: s.name, email: '', days: 0, totalHours: 0 });
    });

    historyData.forEach((r: any) => {
      const key = r.user_id;
      const existing = map.get(key) || { name: r.profiles?.full_name || 'Unknown', email: r.profiles?.email || '', days: 0, totalHours: 0 };
      existing.name = existing.name || r.profiles?.full_name || 'Unknown';
      existing.email = r.profiles?.email || existing.email;
      existing.days += 1;
      if (r.check_in && r.check_out) {
        existing.totalHours += (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 3600000;
      }
      map.set(key, existing);
    });

    return Array.from(map.entries()).map(([userId, data]) => {
      return { userId, ...data, totalDays: daysInMonth };
    }).filter(s => s.days > 0 || allStaffProfiles.some((p: any) => p.user_id === s.userId));
  })();

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
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
            {canForceEntry && (
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
                  toast.info('Opening door...');
                  const result = await remoteOpenDoorByBranch(effectiveBranchId);
                  if (result.success) toast.success(result.message);
                  else toast.error(result.message);
                }}
              >
                <DoorOpen className="h-4 w-4" />
                Override Entry
              </Button>
            )}
            <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-[180px]" />
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

        {/* Rapid-Entry Search Bar */}
        <div className="space-y-2">
          {canRecordStaff && (
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted/60 border">
              <button
                type="button"
                onClick={() => { setActiveTab('members'); setSearchQuery(''); }}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${activeTab !== 'staff-record' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Users className="inline h-3.5 w-3.5 mr-1" />Members
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('staff-record'); setSearchQuery(''); }}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${activeTab === 'staff-record' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <UserCheck className="inline h-3.5 w-3.5 mr-1" />Staff
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Scan className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder={activeTab === 'staff-record' ? "Search staff by name or employee code…" : "Scan barcode or type member code / name / phone…"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-12 h-14 text-lg border-2 focus:border-primary transition-colors"
              />
            </div>
            <Button onClick={handleMemberSearch} disabled={isSearching || activeTab === 'staff-record'} className="h-14 px-6" size="lg">
              <Search className="w-5 h-5 mr-2" />
              {isSearching ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </div>

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
                        checkOut(member.id);
                        setSearchResults(prev => prev.filter(m => m.id !== member.id));
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
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-0 bg-gradient-to-br from-accent to-accent/80 text-accent-foreground">
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
          <Card className="border-0 bg-gradient-to-br from-success to-success/80 text-success-foreground">
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
          <Card className="border-0 bg-gradient-to-br from-info to-info/80 text-info-foreground">
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
          <Card className="border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
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
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle>Attendance Management</CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                  const exportData = activeTab === 'staff-log' ? filteredStaffAttendance.map((a: any) => ({
                    Name: a.profiles?.full_name || 'Unknown',
                    'Check In': format(new Date(a.check_in), 'yyyy-MM-dd HH:mm'),
                    'Check Out': a.check_out ? format(new Date(a.check_out), 'yyyy-MM-dd HH:mm') : '',
                    Duration: formatDuration(a.check_in, a.check_out),
                  })) : filteredMemberAttendance.map((a: any) => ({
                    Name: a.members?.profiles?.full_name || 'Unknown',
                    Code: a.members?.member_code || '',
                    'Check In': format(new Date(a.check_in), 'yyyy-MM-dd HH:mm'),
                    'Check Out': a.check_out ? format(new Date(a.check_out), 'yyyy-MM-dd HH:mm') : '',
                    Duration: formatDuration(a.check_in, a.check_out),
                    Source: a.check_in_method || 'manual',
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
              <TabsList className="mb-4">
                <TabsTrigger value="members" className="gap-2"><Users className="h-4 w-4" />Members ({filteredMemberAttendance.length})</TabsTrigger>
                <TabsTrigger value="staff-record" className="gap-2"><UserCheck className="h-4 w-4" />Staff Check-in</TabsTrigger>
                <TabsTrigger value="staff-log" className="gap-2"><Clock className="h-4 w-4" />Staff Log ({filteredStaffAttendance.length})</TabsTrigger>
                <TabsTrigger value="pt" className="gap-2"><Dumbbell className="h-4 w-4" />PT Sessions</TabsTrigger>
                <TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" />History</TabsTrigger>
              </TabsList>

              {/* PT Sessions Tab */}
              <TabsContent value="pt">
                <PtAttendanceTabContent />
              </TabsContent>

              {/* Members Tab */}
              <TabsContent value="members">
                {/* Bulk Check-out */}
                {memberAttendance.some((a: any) => !a.check_out) && (
                  <div className="flex justify-end mb-4">
                    <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                      const activeIds = memberAttendance.filter((a: any) => !a.check_out).map((a: any) => a.member_id);
                      let count = 0;
                      for (const mid of activeIds) {
                        try { await checkOut(mid); count++; } catch {}
                      }
                      toast.success(`Checked out ${count} member(s)`);
                    }}>
                      <LogOut className="h-4 w-4" />
                      Bulk Check Out ({memberAttendance.filter((a: any) => !a.check_out).length})
                    </Button>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMemberAttendance.map((attendance: any) => (
                      <TableRow key={attendance.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={attendance.members?.profiles?.avatar_url} />
                              <AvatarFallback className="bg-accent/10 text-accent text-xs">{getInitials(attendance.members?.profiles?.full_name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{attendance.members?.profiles?.full_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{attendance.members?.member_code}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{format(new Date(attendance.check_in), 'HH:mm')}</TableCell>
                        <TableCell>{attendance.check_out ? format(new Date(attendance.check_out), 'HH:mm') : '-'}</TableCell>
                        <TableCell>{formatDuration(attendance.check_in, attendance.check_out)}</TableCell>
                        <TableCell>{getSourceBadge(attendance)}</TableCell>
                        <TableCell>
                          {attendance.check_out ? (
                            <Badge className="bg-muted text-muted-foreground border-border">Completed</Badge>
                          ) : (
                            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" disabled={isCheckingOut} onClick={() => checkOut(attendance.member_id)}>
                              <LogOut className="h-3 w-3" /> Check Out
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredMemberAttendance.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No member attendance records</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* Staff Check-in Tab */}
              <TabsContent value="staff-record">
                {!canRecordStaff ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShieldAlert className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Only admins and managers can record staff attendance</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Hardware-failure fallback banner */}
                    <div className="flex items-start gap-3 p-3 rounded-lg border border-warning/30 bg-warning/5">
                      <ShieldAlert className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                      <div className="flex-1 text-sm">
                        <p className="font-medium text-foreground">Biometric-failure fallback only</p>
                        <p className="text-muted-foreground text-xs mt-0.5">
                          Use this only when the turnstile is offline. Every entry is audited and tied to your user. Self-attendance is never allowed — even for owners.
                        </p>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7">
                            <Info className="h-3.5 w-3.5" />
                            Hierarchy
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 text-xs space-y-2">
                          <p className="font-semibold text-sm text-foreground">Who can record attendance for whom</p>
                          <ul className="space-y-1 text-muted-foreground">
                            <li><span className="font-medium text-foreground">Owner</span> → Admin, Manager, Staff, Trainer</li>
                            <li><span className="font-medium text-foreground">Admin</span> → Manager, Staff, Trainer</li>
                            <li><span className="font-medium text-foreground">Manager</span> → Staff, Trainer</li>
                            <li><span className="font-medium text-foreground">Staff / Trainer</span> → no manual access</li>
                          </ul>
                          <p className="pt-1 border-t text-muted-foreground">Nobody — including the owner — can mark their own attendance. Owner-level entries require a second owner to be present.</p>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Staff Member</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Weekly Off</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allStaffProfiles.filter((s: any) => {
                          if (!searchTerm) return true;
                          return s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.code.toLowerCase().includes(searchTerm.toLowerCase());
                        }).map((staff: any) => {
                          const isCheckedIn = checkedInUserIds.has(staff.user_id);
                          const isSelf = staff.user_id === user?.id;
                          const decision = decisionFor(staff);
                          return (
                            <TableRow key={staff.user_id}>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <Avatar className="h-9 w-9">
                                    <AvatarImage src={staff.avatar_url} />
                                    <AvatarFallback className="bg-accent/10 text-accent text-xs font-semibold">{getInitials(staff.name)}</AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <p className="font-medium">{staff.name} {isSelf && <span className="text-xs text-muted-foreground">(You)</span>}</p>
                                    <p className="text-xs text-muted-foreground">{staff.code}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={`border ${staff.type === 'Trainer' ? 'bg-info/10 text-info border-info/20' : staff.type === 'Owner' ? 'bg-primary/10 text-primary border-primary/20' : staff.type === 'Admin' ? 'bg-warning/10 text-warning border-warning/20' : staff.type === 'Manager' ? 'bg-accent/10 text-accent border-accent/20' : 'bg-muted text-muted-foreground border-border'}`}>
                                  {staff.type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm capitalize">{staff.weekly_off || 'Sunday'}</span>
                              </TableCell>
                              <TableCell>
                                <Badge className={`border ${isCheckedIn ? 'bg-success/10 text-success border-success/20' : 'bg-muted text-muted-foreground border-border'}`}>
                                  {isCheckedIn ? 'Checked In' : 'Not Checked In'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {!decision.allowed ? (
                                  <span className="text-xs text-muted-foreground italic" title={decision.reason}>{decision.reason}</span>
                                ) : isCheckedIn ? (
                                  <Button size="sm" variant="outline" className="gap-1.5" disabled={isStaffCheckingOut} onClick={() => handleStaffCheckOut(staff)}>
                                    <LogOut className="h-3.5 w-3.5" />Check Out
                                  </Button>
                                ) : (
                                  <Button size="sm" className="gap-1.5 bg-success hover:bg-success/90 text-success-foreground" disabled={isStaffCheckingIn} onClick={() => handleStaffCheckIn(staff)}>
                                    <LogIn className="h-3.5 w-3.5" />Check In
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {allStaffProfiles.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No staff found for this branch</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* Staff Log Tab */}
              <TabsContent value="staff-log">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStaffAttendance.map((attendance: any) => (
                      <TableRow key={attendance.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={attendance.profiles?.avatar_url} />
                              <AvatarFallback className="bg-success/10 text-success text-xs">{getInitials(attendance.profiles?.full_name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{attendance.profiles?.full_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{attendance.profiles?.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{format(new Date(attendance.check_in), 'HH:mm')}</TableCell>
                        <TableCell>{attendance.check_out ? format(new Date(attendance.check_out), 'HH:mm') : '-'}</TableCell>
                        <TableCell>{formatDuration(attendance.check_in, attendance.check_out)}</TableCell>
                        <TableCell>
                          <Badge className={`border ${attendance.check_out ? 'bg-muted text-muted-foreground border-border' : 'bg-success/10 text-success border-success/20'}`}>
                            {attendance.check_out ? 'Completed' : 'Active'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredStaffAttendance.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No staff attendance records</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* History Tab with WO */}
              <TabsContent value="history">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Label>Month</Label>
                    <Input type="month" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} className="w-[200px]" />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {historyStaffSummary.map((s) => (
                      <Card key={s.userId} className="border">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={allStaffProfiles.find((sp: any) => sp.user_id === s.userId)?.avatar_url} />
                              <AvatarFallback className="bg-accent/10 text-accent text-sm font-semibold">{getInitials(s.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{s.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="bg-success/10 rounded-lg p-2 text-center">
                              <p className="text-lg font-bold text-success">{s.days}</p>
                              <p className="text-xs text-muted-foreground">Present</p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-lg font-bold text-foreground">{s.totalDays}</p>
                              <p className="text-xs text-muted-foreground">Total Days</p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-lg font-bold text-foreground">{Math.round(s.totalHours * 10) / 10}h</p>
                              <p className="text-xs text-muted-foreground">Hours</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {historyStaffSummary.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No attendance records for this month</p>
                    </div>
                  )}
                </div>
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
