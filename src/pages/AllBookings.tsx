import { useState, useMemo, useEffect } from 'react';
import { useHighlightRow } from '@/hooks/useHighlightRow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatCard } from '@/components/ui/stat-card';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Calendar, Users, Heart, Dumbbell, Clock, Search, Check, X, Filter, Plus, ChevronLeft, ChevronRight, List, CalendarDays, ShieldAlert, ChevronDown, Activity, Download, Printer } from 'lucide-react';
import { exportToCSV } from '@/lib/csvExport';
import { escapeHtml as e } from '@/utils/htmlEscape';
import { ConciergeBookingDrawer } from '@/components/bookings/ConciergeBookingDrawer';
import { SlotAvailabilityTimeline } from '@/components/bookings/SlotAvailabilityTimeline';
import { SlotDetailDrawer } from '@/components/bookings/SlotDetailDrawer';
import { BookingStatusTimeline } from '@/components/bookings/BookingStatusTimeline';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { LivePill } from '@/components/ui/live-pill';

export default function AllBookingsPage() {
  const queryClient = useQueryClient();
  const { effectiveBranchId: branchId = '' } = useBranchContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'timeline'>('list');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null);

  // Cmd+K: ?facility=1 / ?class=1 open the concierge drawer; ?focus handled by useHighlightRow
  useHighlightRow();
  useRealtimeInvalidate({
    channel: 'page-all-bookings',
    tables: ['class_bookings', 'benefit_bookings', 'pt_sessions'],
    invalidateKeys: [
      ['all-class-bookings'],
      ['all-benefit-bookings'],
      ['all-pt-sessions'],
      ['monthly-bookings-calendar'],
    ],
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('facility') === '1' || url.searchParams.get('class') === '1') {
      setConciergeOpen(true);
      url.searchParams.delete('facility');
      url.searchParams.delete('class');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Fetch class bookings
  const { data: classBookings = [], isLoading: loadingClasses } = useQuery({
    queryKey: ['all-class-bookings', branchId, dateFilter],
    enabled: !!branchId,
    queryFn: async () => {
      const startDate = new Date(dateFilter);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateFilter);
      endDate.setHours(23, 59, 59, 999);

      const { data: classes } = await supabase
        .from('classes')
        .select('id, name, scheduled_at')
        .eq('branch_id', branchId)
        .gte('scheduled_at', startDate.toISOString())
        .lte('scheduled_at', endDate.toISOString());

      if (!classes?.length) return [];

      const classIds = classes.map(c => c.id);
      const { data: bookings, error } = await supabase
        .from('class_bookings')
        .select(`*, member:members(id, member_code, user_id)`)
        .in('class_id', classIds);

      if (error) throw error;

      const userIds = (bookings || []).map((b: any) => b.member?.user_id).filter((id): id is string => !!id);
      let profilesMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p.full_name || ''; return acc; }, {} as Record<string, string>);
      }

      const classMap = classes.reduce((acc, c) => { acc[c.id] = { name: c.name, scheduled_at: c.scheduled_at }; return acc; }, {} as Record<string, any>);

      return (bookings || []).map((b: any) => ({
        ...b, type: 'class',
        class_name: classMap[b.class_id]?.name,
        class_time: classMap[b.class_id]?.scheduled_at,
        member_name: b.member?.user_id ? profilesMap[b.member.user_id] : b.member?.member_code,
        member_code: b.member?.member_code,
      }));
    },
  });

  // Fetch benefit bookings
  const { data: benefitBookings = [], isLoading: loadingBenefits } = useQuery({
    queryKey: ['all-benefit-bookings', branchId, dateFilter],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: slots } = await supabase
        .from('benefit_slots')
        .select('id, benefit_type, benefit_type_id, start_time, end_time, slot_date')
        .eq('branch_id', branchId)
        .eq('slot_date', dateFilter);

      if (!slots?.length) return [];

      const slotIds = slots.map(s => s.id);
      const { data: bookings, error } = await supabase
        .from('benefit_bookings')
        .select(`*, member:members(id, member_code, user_id)`)
        .in('slot_id', slotIds);

      if (error) throw error;

      const memberUserIds = (bookings || []).map((b: any) => b.member?.user_id).filter((id): id is string => !!id);
      const staffUserIds = (bookings || []).map((b: any) => b.booked_by_staff_id).filter((id): id is string => !!id);
      const allIds = [...new Set([...memberUserIds, ...staffUserIds])];
      let profilesMap: Record<string, string> = {};
      if (allIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', allIds);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p.full_name || ''; return acc; }, {} as Record<string, string>);
      }

      const benefitTypeIds = [...new Set(slots.map(s => s.benefit_type_id).filter(Boolean))];
      let benefitTypeNames: Record<string, string> = {};
      if (benefitTypeIds.length > 0) {
        const { data: types } = await supabase.from('benefit_types').select('id, name').in('id', benefitTypeIds);
        benefitTypeNames = (types || []).reduce((acc, t) => { acc[t.id] = t.name; return acc; }, {} as Record<string, string>);
      }

      const slotMap = slots.reduce((acc, s) => {
        acc[s.id] = { benefit_type: s.benefit_type, benefit_name: s.benefit_type_id ? benefitTypeNames[s.benefit_type_id] : s.benefit_type, start_time: s.start_time, end_time: s.end_time, slot_date: s.slot_date };
        return acc;
      }, {} as Record<string, any>);

      return (bookings || []).map((b: any) => ({
        ...b, type: 'benefit',
        benefit_name: slotMap[b.slot_id]?.benefit_name || slotMap[b.slot_id]?.benefit_type,
        slot_time: `${slotMap[b.slot_id]?.start_time} - ${slotMap[b.slot_id]?.end_time}`,
        slot_date: slotMap[b.slot_id]?.slot_date,
        member_name: b.member?.user_id ? profilesMap[b.member.user_id] : b.member?.member_code,
        member_code: b.member?.member_code,
        booked_by_name: b.booked_by_staff_id ? profilesMap[b.booked_by_staff_id] : null,
      }));
    },
  });

  // Fetch PT sessions
  const { data: ptSessions = [], isLoading: loadingPT } = useQuery({
    queryKey: ['all-pt-sessions', branchId, dateFilter],
    enabled: !!branchId,
    queryFn: async () => {
      const startDate = new Date(dateFilter); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateFilter); endDate.setHours(23, 59, 59, 999);

      const { data: sessions, error } = await supabase
        .from('pt_sessions')
        .select(`*, member_pt_package:member_pt_packages(member:members(id, member_code, user_id)), trainer:trainers(id, user_id)`)
        .eq('branch_id', branchId)
        .gte('scheduled_at', startDate.toISOString())
        .lte('scheduled_at', endDate.toISOString());

      if (error) throw error;

      const userIds = [...(sessions || []).map((s: any) => s.member_pt_package?.member?.user_id), ...(sessions || []).map((s: any) => s.trainer?.user_id)].filter((id): id is string => !!id);
      let profilesMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(userIds)]);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p.full_name || ''; return acc; }, {} as Record<string, string>);
      }

      return (sessions || []).map((s: any) => ({
        ...s, type: 'pt',
        member_name: s.member_pt_package?.member?.user_id ? profilesMap[s.member_pt_package.member.user_id] : s.member_pt_package?.member?.member_code,
        member_code: s.member_pt_package?.member?.member_code,
        trainer_name: s.trainer?.user_id ? profilesMap[s.trainer.user_id] : 'Unknown Trainer',
      }));
    },
  });

  // Fetch monthly bookings for calendar
  const { data: monthlyBookings = { classes: 0, benefits: 0, pt: 0, byDay: {} as Record<string, number> } } = useQuery({
    queryKey: ['monthly-bookings-calendar', branchId, format(calendarMonth, 'yyyy-MM')],
    enabled: !!branchId && viewMode === 'calendar',
    queryFn: async () => {
      const ms = startOfMonth(calendarMonth);
      const me = endOfMonth(calendarMonth);

      const { data: classes } = await supabase
        .from('classes')
        .select('id, scheduled_at')
        .eq('branch_id', branchId)
        .gte('scheduled_at', ms.toISOString())
        .lte('scheduled_at', me.toISOString());

      const classIds = (classes || []).map(c => c.id);
      let classCount = 0;
      const byDay: Record<string, number> = {};

      if (classIds.length > 0) {
        const { count } = await supabase.from('class_bookings').select('id', { count: 'exact', head: true }).in('class_id', classIds);
        classCount = count || 0;
        // Map class bookings to days
        for (const cls of classes || []) {
          const day = format(new Date(cls.scheduled_at), 'yyyy-MM-dd');
          byDay[day] = (byDay[day] || 0) + 1;
        }
      }

      const { data: slots } = await supabase
        .from('benefit_slots')
        .select('id, slot_date')
        .eq('branch_id', branchId)
        .gte('slot_date', format(ms, 'yyyy-MM-dd'))
        .lte('slot_date', format(me, 'yyyy-MM-dd'));

      const slotIds = (slots || []).map(s => s.id);
      let benefitCount = 0;
      if (slotIds.length > 0) {
        const { count } = await supabase.from('benefit_bookings').select('id', { count: 'exact', head: true }).in('slot_id', slotIds);
        benefitCount = count || 0;
        for (const slot of slots || []) {
          byDay[slot.slot_date] = (byDay[slot.slot_date] || 0) + 1;
        }
      }

      const { count: ptCount } = await supabase
        .from('pt_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .gte('scheduled_at', ms.toISOString())
        .lte('scheduled_at', me.toISOString());

      return { classes: classCount, benefits: benefitCount, pt: ptCount || 0, byDay };
    },
  });

  const filterBookings = (bookings: any[]) => {
    return bookings.filter(b => {
      const matchesSearch = !searchQuery || b.member_name?.toLowerCase().includes(searchQuery.toLowerCase()) || b.member_code?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      const matchesSource = sourceFilter === 'all' || (b.source || 'member_portal') === sourceFilter;
      return matchesSearch && matchesStatus && matchesSource;
    });
  };

  const SOURCE_BADGE: Record<string, string> = {
    member_portal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    concierge: 'bg-violet-50 text-violet-700 border-violet-200',
    whatsapp_ai: 'bg-sky-50 text-sky-700 border-sky-200',
    admin: 'bg-amber-50 text-amber-700 border-amber-200',
    system: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  const renderSourceBadge = (source?: string) => {
    const s = source || 'member_portal';
    return <Badge variant="outline" className={`text-[10px] capitalize ${SOURCE_BADGE[s] || ''}`}>{s.replace('_', ' ')}</Badge>;
  };

  const filteredClassBookings = filterBookings(classBookings);
  const filteredBenefitBookings = filterBookings(benefitBookings);
  const filteredPTSessions = filterBookings(ptSessions);

  const totalBookings = classBookings.length + benefitBookings.length + ptSessions.length;
  const confirmedBookings = [...classBookings, ...benefitBookings, ...ptSessions].filter(b => ['booked', 'confirmed', 'scheduled'].includes(b.status)).length;
  const attendedBookings = [...classBookings, ...benefitBookings, ...ptSessions].filter(b => ['attended', 'checked_in', 'completed'].includes(b.status)).length;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      booked: 'secondary', confirmed: 'secondary', scheduled: 'secondary',
      attended: 'default', checked_in: 'default', completed: 'default',
      cancelled: 'outline', no_show: 'destructive',
    };
    return <Badge variant={variants[status] || 'outline'}>{status.replace('_', ' ')}</Badge>;
  };

  // Calendar helpers
  const calStart = startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 });
  const calEnd = endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 });
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
                <Calendar className="h-6 w-6" />
              </div>
              All Bookings
            </h1>
            <p className="text-muted-foreground mt-1">View all member bookings across classes, benefits, and PT sessions</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-muted rounded-xl p-1">
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-lg gap-1.5">
                <List className="h-4 w-4" /> List
              </Button>
              <Button variant={viewMode === 'timeline' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('timeline')} className="rounded-lg gap-1.5">
                <Activity className="h-4 w-4" /> Timeline
              </Button>
              <Button variant={viewMode === 'calendar' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('calendar')} className="rounded-lg gap-1.5">
                <CalendarDays className="h-4 w-4" /> Calendar
              </Button>
            </div>
            <Button onClick={() => setConciergeOpen(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/20">
              <Plus className="h-4 w-4" /> New Booking
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Total Bookings" value={totalBookings} icon={Calendar} />
          <StatCard title="Confirmed" value={confirmedBookings} icon={Check} />
          <StatCard title="Attended" value={attendedBookings} icon={Users} />
          <StatCard title="Date" value={format(new Date(dateFilter), 'dd MMM')} icon={Clock} />
        </div>

        {/* Calendar View */}
        {viewMode === 'calendar' && (
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{format(calendarMonth, 'MMMM yyyy')}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCalendarMonth(d => subMonths(d, 1))} className="rounded-xl"><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setCalendarMonth(new Date())} className="rounded-xl">Today</Button>
                  <Button variant="outline" size="icon" onClick={() => setCalendarMonth(d => addMonths(d, 1))} className="rounded-xl"><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calDays.map((day, idx) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const bookingCount = monthlyBookings.byDay[dayStr] || 0;
                  const isCurrentMonth = isSameMonth(day, calendarMonth);
                  const isToday = isSameDay(day, new Date());
                  const isSelected = dayStr === dateFilter;
                  return (
                    <div
                      key={idx}
                      className={`bg-card p-2 min-h-[70px] cursor-pointer hover:bg-muted/50 transition-colors ${!isCurrentMonth ? 'opacity-40' : ''} ${isToday ? 'ring-2 ring-primary ring-inset' : ''} ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => { setDateFilter(dayStr); setViewMode('list'); }}
                    >
                      <p className={`text-xs font-medium mb-1 ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>{format(day, 'd')}</p>
                      {bookingCount > 0 && (
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">{bookingCount} booking{bookingCount > 1 ? 's' : ''}</Badge>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timeline View */}
        {viewMode === 'timeline' && (
          <div className="space-y-4">
            <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-[180px] rounded-xl" />
                  <p className="text-sm text-muted-foreground">Click any slot chip to view attendees and full audit history.</p>
                </div>
              </CardContent>
            </Card>
            <SlotAvailabilityTimeline branchId={branchId} date={dateFilter} onSlotClick={setActiveSlotId} />
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <>
            {/* Filters */}
            <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
              <CardContent className="pt-5">
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by member name or code..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 rounded-xl" />
                  </div>
                  <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-[180px] rounded-xl" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px] rounded-xl"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="booked">Booked</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="attended">Attended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no_show">No Show</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[160px] rounded-xl"><SelectValue placeholder="Source" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="member_portal">Member Portal</SelectItem>
                      <SelectItem value="concierge">Concierge</SelectItem>
                      <SelectItem value="whatsapp_ai">WhatsApp AI</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Booking Tabs */}
            <Tabs defaultValue="classes" className="space-y-4">
              <TabsList className="rounded-xl">
                <TabsTrigger value="classes" className="gap-2 rounded-lg"><Calendar className="h-4 w-4" />Classes ({filteredClassBookings.length})</TabsTrigger>
                <TabsTrigger value="benefits" className="gap-2 rounded-lg"><Heart className="h-4 w-4" />Benefits ({filteredBenefitBookings.length})</TabsTrigger>
                <TabsTrigger value="pt" className="gap-2 rounded-lg"><Dumbbell className="h-4 w-4" />PT ({filteredPTSessions.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="classes">
                <Card className="rounded-2xl">
                  <CardHeader><CardTitle>Class Bookings</CardTitle><CardDescription>Member bookings for group classes</CardDescription></CardHeader>
                  <CardContent>
                    {loadingClasses ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : filteredClassBookings.length === 0 ? <div className="text-center py-8 text-muted-foreground">No class bookings found for this date</div> : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Class</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead>Booked At</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {filteredClassBookings.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell><div className="font-medium">{b.member_name}</div><div className="text-sm text-muted-foreground">{b.member_code}</div></TableCell>
                              <TableCell>{b.class_name}</TableCell>
                              <TableCell>{b.class_time && format(new Date(b.class_time), 'HH:mm')}</TableCell>
                              <TableCell>{getStatusBadge(b.status)}</TableCell>
                              <TableCell className="text-muted-foreground">{format(new Date(b.booked_at), 'dd MMM HH:mm')}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="benefits">
                <Card className="rounded-2xl">
                  <CardHeader><CardTitle>Benefit Bookings</CardTitle><CardDescription>Sauna, ice bath, and other benefits</CardDescription></CardHeader>
                  <CardContent>
                    {loadingBenefits ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : filteredBenefitBookings.length === 0 ? <div className="text-center py-8 text-muted-foreground">No benefit bookings for this date</div> : (
                      <Table>
                        <TableHeader><TableRow><TableHead className="w-8"></TableHead><TableHead>Member</TableHead><TableHead>Benefit</TableHead><TableHead>Time Slot</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Booked At</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {filteredBenefitBookings.map((b: any) => {
                            const isOpen = expandedBooking === b.id;
                            return (
                              <>
                                <TableRow key={b.id} className="cursor-pointer" onClick={() => setExpandedBooking(isOpen ? null : b.id)}>
                                  <TableCell><ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`} /></TableCell>
                                  <TableCell>
                                    <div className="font-medium flex items-center gap-1.5">
                                      {b.member_name}
                                      {b.force_added && <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />}
                                    </div>
                                    <div className="text-sm text-muted-foreground">{b.member_code}</div>
                                  </TableCell>
                                  <TableCell><Badge variant="outline">{b.benefit_name}</Badge></TableCell>
                                  <TableCell>{b.slot_time}</TableCell>
                                  <TableCell>
                                    <div className="flex flex-col gap-0.5">
                                      {renderSourceBadge(b.source)}
                                      {b.booked_by_name && <span className="text-[10px] text-muted-foreground">by {b.booked_by_name}</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell>{getStatusBadge(b.status)}</TableCell>
                                  <TableCell className="text-muted-foreground">{format(new Date(b.booked_at), 'dd MMM HH:mm')}</TableCell>
                                </TableRow>
                                {isOpen && (
                                  <TableRow key={b.id + '-audit'}>
                                    <TableCell colSpan={7} className="bg-muted/30">
                                      <BookingStatusTimeline bookingId={b.id} />
                                    </TableCell>
                                  </TableRow>
                                )}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="pt">
                <Card className="rounded-2xl">
                  <CardHeader><CardTitle>PT Sessions</CardTitle><CardDescription>Personal training sessions</CardDescription></CardHeader>
                  <CardContent>
                    {loadingPT ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : filteredPTSessions.length === 0 ? <div className="text-center py-8 text-muted-foreground">No PT sessions for this date</div> : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Trainer</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {filteredPTSessions.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell><div className="font-medium">{s.member_name}</div><div className="text-sm text-muted-foreground">{s.member_code}</div></TableCell>
                              <TableCell>{s.trainer_name}</TableCell>
                              <TableCell>{s.session_date && format(new Date(s.session_date), 'HH:mm')}</TableCell>
                              <TableCell>{getStatusBadge(s.status)}</TableCell>
                              <TableCell className="text-muted-foreground max-w-[200px] truncate">{s.notes || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <ConciergeBookingDrawer
        open={conciergeOpen}
        onOpenChange={setConciergeOpen}
        branchId={branchId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['all-benefit-bookings'] });
          queryClient.invalidateQueries({ queryKey: ['all-class-bookings'] });
          queryClient.invalidateQueries({ queryKey: ['all-pt-sessions'] });
        }}
      />
      <SlotDetailDrawer slotId={activeSlotId} onClose={() => setActiveSlotId(null)} />
    </AppLayout>
  );
}
