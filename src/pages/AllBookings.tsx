import { useState, useMemo, useEffect } from 'react';
import { useHighlightRow } from '@/hooks/useHighlightRow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth,
  addMonths, subMonths, startOfWeek, endOfWeek, addDays, parseISO, differenceInMinutes,
} from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatCard } from '@/components/ui/stat-card';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  Calendar, Users, Heart, Dumbbell, Clock, Search, Check, Filter, Plus, ChevronLeft,
  ChevronRight, List, CalendarDays, ShieldAlert, ChevronDown, Activity, Download, Printer,
  Flame, CalendarClock, AlertTriangle,
} from 'lucide-react';
import { exportToCSV } from '@/lib/csvExport';
import { escapeHtml as e } from '@/utils/htmlEscape';
import { ConciergeBookingDrawer } from '@/components/bookings/ConciergeBookingDrawer';
import { SlotAvailabilityTimeline } from '@/components/bookings/SlotAvailabilityTimeline';
import { SlotDetailDrawer } from '@/components/bookings/SlotDetailDrawer';
import { BookingStatusTimeline } from '@/components/bookings/BookingStatusTimeline';
import { RescheduleBookingDrawer, type RescheduleTarget } from '@/components/bookings/RescheduleBookingDrawer';
import { AttendanceActions } from '@/components/bookings/AttendanceActions';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { cn } from '@/lib/utils';

type RangePreset = 'today' | '3d' | '7d' | 'custom';
type ViewMode = 'list' | 'prep' | 'calendar' | 'timeline';

export default function AllBookingsPage() {
  const queryClient = useQueryClient();
  const { effectiveBranchId: branchId = '' } = useBranchContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d');
  const [customStart, setCustomStart] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [timelineDate, setTimelineDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Countdown ticker for the prep queue.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { startDate, endDate } = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (rangePreset === 'today') return { startDate: today, endDate: today };
    if (rangePreset === '3d') return { startDate: today, endDate: format(addDays(new Date(), 3), 'yyyy-MM-dd') };
    if (rangePreset === '7d') return { startDate: today, endDate: format(addDays(new Date(), 7), 'yyyy-MM-dd') };
    return { startDate: customStart, endDate: customEnd };
  }, [rangePreset, customStart, customEnd]);

  useHighlightRow();
  useRealtimeInvalidate({
    channel: 'page-all-bookings',
    tables: ['class_bookings', 'benefit_bookings', 'pt_sessions', 'member_comps', 'member_benefit_credits', 'approval_requests'],
    invalidateKeys: [
      ['all-class-bookings'],
      ['all-benefit-bookings'],
      ['all-pt-sessions'],
      ['monthly-bookings-calendar'],
      ['concierge-facilities'],
      ['concierge-slots'],
      ['member-benefit-credits'],
      ['pending-reschedules'],
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

  const dayBounds = (d: string, end = false) => {
    const dt = new Date(d);
    dt.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    return dt.toISOString();
  };

  // ---------- Class bookings ----------
  const { data: classBookings = [], isLoading: loadingClasses } = useQuery({
    queryKey: ['all-class-bookings', branchId, startDate, endDate],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: classes } = await supabase
        .from('classes')
        .select('id, name, scheduled_at')
        .eq('branch_id', branchId)
        .gte('scheduled_at', dayBounds(startDate))
        .lte('scheduled_at', dayBounds(endDate, true));

      if (!classes?.length) return [];

      const classIds = classes.map((c) => c.id);
      const { data: bookings, error } = await supabase
        .from('class_bookings')
        .select('*, member:members(id, member_code, user_id)')
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
        ...b,
        type: 'class',
        class_name: classMap[b.class_id]?.name,
        class_time: classMap[b.class_id]?.scheduled_at,
        day: classMap[b.class_id]?.scheduled_at ? format(new Date(classMap[b.class_id].scheduled_at), 'yyyy-MM-dd') : startDate,
        member_name: b.member?.user_id ? profilesMap[b.member.user_id] : b.member?.member_code,
        member_code: b.member?.member_code,
      }));
    },
  });

  // ---------- Benefit bookings (range + prep metadata) ----------
  const { data: benefitBookings = [], isLoading: loadingBenefits } = useQuery({
    queryKey: ['all-benefit-bookings', branchId, startDate, endDate],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: slots } = await supabase
        .from('benefit_slots')
        .select('id, benefit_type, benefit_type_id, facility_id, start_time, end_time, slot_date')
        .eq('branch_id', branchId)
        .gte('slot_date', startDate)
        .lte('slot_date', endDate);

      if (!slots?.length) return [];

      const slotIds = slots.map((s) => s.id);
      const { data: bookings, error } = await supabase
        .from('benefit_bookings')
        .select('*, member:members(id, member_code, user_id)')
        .in('slot_id', slotIds);
      if (error) throw error;
      if (!bookings?.length) return [];

      const memberUserIds = bookings.map((b: any) => b.member?.user_id).filter((id): id is string => !!id);
      const staffUserIds = bookings.map((b: any) => b.booked_by_staff_id).filter((id): id is string => !!id);
      const allIds = [...new Set([...memberUserIds, ...staffUserIds])];
      let profilesMap: Record<string, string> = {};
      if (allIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', allIds);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p.full_name || ''; return acc; }, {} as Record<string, string>);
      }

      const benefitTypeIds = [...new Set(slots.map((s) => s.benefit_type_id).filter(Boolean))] as string[];
      let benefitTypeNames: Record<string, string> = {};
      if (benefitTypeIds.length > 0) {
        const { data: types } = await supabase.from('benefit_types').select('id, name').in('id', benefitTypeIds);
        benefitTypeNames = (types || []).reduce((acc, t) => { acc[t.id] = t.name; return acc; }, {} as Record<string, string>);
      }

      const facilityIds = [...new Set(slots.map((s) => s.facility_id).filter(Boolean))] as string[];
      let facilities: Record<string, { name: string; prep: number }> = {};
      if (facilityIds.length > 0) {
        const { data: facs } = await supabase
          .from('facilities')
          .select('id, name, prep_lead_minutes')
          .in('id', facilityIds);
        facilities = (facs || []).reduce((acc, f: any) => {
          acc[f.id] = { name: f.name, prep: f.prep_lead_minutes || 0 };
          return acc;
        }, {} as Record<string, { name: string; prep: number }>);
      }

      const slotMap = slots.reduce((acc, s) => {
        acc[s.id] = s;
        return acc;
      }, {} as Record<string, any>);

      return bookings.map((b: any) => {
        const s = slotMap[b.slot_id];
        const facility = s?.facility_id ? facilities[s.facility_id] : undefined;
        const startsAt = s ? new Date(`${s.slot_date}T${s.start_time}`) : null;
        const prepMinutes = facility?.prep ?? 0;
        return {
          ...b,
          type: 'benefit',
          benefit_name: facility?.name || (s?.benefit_type_id ? benefitTypeNames[s.benefit_type_id] : s?.benefit_type),
          slot_time: s ? `${String(s.start_time).slice(0, 5)} - ${String(s.end_time).slice(0, 5)}` : '',
          slot_date: s?.slot_date,
          day: s?.slot_date || startDate,
          starts_at: startsAt,
          prep_minutes: prepMinutes,
          prep_start_at: startsAt && prepMinutes ? new Date(startsAt.getTime() - prepMinutes * 60_000) : null,
          member_name: b.member?.user_id ? profilesMap[b.member.user_id] : b.member?.member_code,
          member_code: b.member?.member_code,
          booked_by_name: b.booked_by_staff_id ? profilesMap[b.booked_by_staff_id] : null,
        };
      });
    },
  });

  // ---------- Pending reschedule approvals ----------
  const { data: pendingReschedules = {} as Record<string, true> } = useQuery({
    queryKey: ['pending-reschedules', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data } = await supabase
        .from('approval_requests')
        .select('reference_id')
        .eq('approval_type', 'booking_reschedule')
        .eq('status', 'pending');
      return (data || []).reduce((acc, r: any) => { acc[r.reference_id] = true; return acc; }, {} as Record<string, true>);
    },
  });

  // ---------- PT sessions ----------
  const { data: ptSessions = [], isLoading: loadingPT } = useQuery({
    queryKey: ['all-pt-sessions', branchId, startDate, endDate],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from('pt_sessions')
        .select('*, member_pt_package:member_pt_packages(member:members(id, member_code, user_id)), trainer:trainers(id, user_id)')
        .eq('branch_id', branchId)
        .gte('scheduled_at', dayBounds(startDate))
        .lte('scheduled_at', dayBounds(endDate, true));
      if (error) throw error;

      const userIds = [
        ...(sessions || []).map((s: any) => s.member_pt_package?.member?.user_id),
        ...(sessions || []).map((s: any) => s.trainer?.user_id),
      ].filter((id): id is string => !!id);
      let profilesMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(userIds)]);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p.full_name || ''; return acc; }, {} as Record<string, string>);
      }

      return (sessions || []).map((s: any) => ({
        ...s,
        type: 'pt',
        day: s.scheduled_at ? format(new Date(s.scheduled_at), 'yyyy-MM-dd') : startDate,
        member_name: s.member_pt_package?.member?.user_id ? profilesMap[s.member_pt_package.member.user_id] : s.member_pt_package?.member?.member_code,
        member_code: s.member_pt_package?.member?.member_code,
        trainer_name: s.trainer?.user_id ? profilesMap[s.trainer.user_id] : 'Unknown Trainer',
      }));
    },
  });

  // ---------- Calendar month counts (split by type) ----------
  const { data: monthlyBookings = { byDay: {} as Record<string, { classes: number; benefits: number; pt: number }> } } = useQuery({
    queryKey: ['monthly-bookings-calendar', branchId, format(calendarMonth, 'yyyy-MM')],
    enabled: !!branchId && viewMode === 'calendar',
    queryFn: async () => {
      const ms = startOfMonth(calendarMonth);
      const me = endOfMonth(calendarMonth);
      const byDay: Record<string, { classes: number; benefits: number; pt: number }> = {};
      const bump = (day: string, key: 'classes' | 'benefits' | 'pt') => {
        byDay[day] = byDay[day] || { classes: 0, benefits: 0, pt: 0 };
        byDay[day][key] += 1;
      };

      const { data: classes } = await supabase
        .from('classes').select('id, scheduled_at').eq('branch_id', branchId)
        .gte('scheduled_at', ms.toISOString()).lte('scheduled_at', me.toISOString());
      const classIds = (classes || []).map((c) => c.id);
      if (classIds.length) {
        const { data: cb } = await supabase.from('class_bookings').select('class_id').in('class_id', classIds);
        const clsMap = (classes || []).reduce((a, c) => { a[c.id] = c.scheduled_at; return a; }, {} as Record<string, string>);
        (cb || []).forEach((b: any) => { if (clsMap[b.class_id]) bump(format(new Date(clsMap[b.class_id]), 'yyyy-MM-dd'), 'classes'); });
      }

      const { data: slots } = await supabase
        .from('benefit_slots').select('id, slot_date').eq('branch_id', branchId)
        .gte('slot_date', format(ms, 'yyyy-MM-dd')).lte('slot_date', format(me, 'yyyy-MM-dd'));
      const slotIds = (slots || []).map((s) => s.id);
      if (slotIds.length) {
        const { data: bb } = await supabase.from('benefit_bookings').select('slot_id').in('slot_id', slotIds);
        const slotMap = (slots || []).reduce((a, s) => { a[s.id] = s.slot_date; return a; }, {} as Record<string, string>);
        (bb || []).forEach((b: any) => { if (slotMap[b.slot_id]) bump(slotMap[b.slot_id], 'benefits'); });
      }

      const { data: pt } = await supabase
        .from('pt_sessions').select('scheduled_at').eq('branch_id', branchId)
        .gte('scheduled_at', ms.toISOString()).lte('scheduled_at', me.toISOString());
      (pt || []).forEach((s: any) => { if (s.scheduled_at) bump(format(new Date(s.scheduled_at), 'yyyy-MM-dd'), 'pt'); });

      return { byDay };
    },
  });

  // ---------- Filtering ----------
  const filterBookings = (bookings: any[]) =>
    bookings.filter((b) => {
      const matchesSearch = !searchQuery
        || b.member_name?.toLowerCase().includes(searchQuery.toLowerCase())
        || b.member_code?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      const matchesSource = sourceFilter === 'all' || (b.source || 'member_portal') === sourceFilter;
      return matchesSearch && matchesStatus && matchesSource;
    });

  const SOURCE_BADGE: Record<string, string> = {
    member_portal: 'bg-success/10 text-success border-success/25',
    concierge: 'bg-primary/10 text-primary border-primary/25',
    whatsapp_ai: 'bg-info/10 text-info border-info/25',
    admin: 'bg-warning/10 text-warning border-warning/25',
    system: 'bg-muted text-foreground border-border',
  };
  const renderSourceBadge = (source?: string) => {
    const s = source || 'member_portal';
    return <Badge variant="outline" className={`text-[10px] capitalize ${SOURCE_BADGE[s] || ''}`}>{s.replace('_', ' ')}</Badge>;
  };

  const filteredClassBookings = filterBookings(classBookings);
  const filteredBenefitBookings = filterBookings(benefitBookings);
  const filteredPTSessions = filterBookings(ptSessions);

  // ---------- Prep queue ----------
  const prepQueue = useMemo(() => {
    return benefitBookings
      .filter((b: any) => b.prep_minutes > 0 && b.prep_start_at && ['booked', 'confirmed'].includes(b.status))
      .filter((b: any) => b.starts_at && b.starts_at.getTime() > now.getTime() - 60 * 60_000)
      .sort((a: any, b: any) => a.prep_start_at.getTime() - b.prep_start_at.getTime());
  }, [benefitBookings, now]);

  const prepDueNow = prepQueue.filter((b: any) => b.prep_start_at.getTime() <= now.getTime()).length;

  const countdownLabel = (target: Date) => {
    const mins = differenceInMinutes(target, now);
    if (mins <= 0) return 'Start now';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `in ${h > 0 ? `${h}h ` : ''}${m}m`;
  };

  const totalBookings = classBookings.length + benefitBookings.length + ptSessions.length;
  const confirmedBookings = [...classBookings, ...benefitBookings, ...ptSessions].filter((b) => ['booked', 'confirmed', 'scheduled'].includes(b.status)).length;
  const attendedBookings = [...classBookings, ...benefitBookings, ...ptSessions].filter((b) => ['attended', 'checked_in', 'completed'].includes(b.status)).length;

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

  const groupByDay = <T extends { day?: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    rows.forEach((r) => {
      const key = r.day || startDate;
      map.set(key, [...(map.get(key) || []), r]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const rangeLabel = startDate === endDate
    ? format(parseISO(startDate), 'dd MMM')
    : `${format(parseISO(startDate), 'dd MMM')} – ${format(parseISO(endDate), 'dd MMM')}`;

  // ---------- Export / print ----------
  const buildUnifiedRows = () => {
    const fmtTime = (iso?: string) => (iso ? format(new Date(iso), 'hh:mm a') : '');
    const rows: Record<string, string>[] = [];
    filteredClassBookings.forEach((b: any) => rows.push({
      date: b.day, time: fmtTime(b.class_time), type: 'Class', item: b.class_name || '',
      member_code: b.member_code || '', member_name: b.member_name || '',
      status: (b.status || '').replace('_', ' '), source: (b.source || 'member_portal').replace('_', ' '), booked_by: '',
    }));
    filteredBenefitBookings.forEach((b: any) => rows.push({
      date: b.slot_date || b.day, time: b.slot_time || '', type: 'Benefit', item: b.benefit_name || '',
      member_code: b.member_code || '', member_name: b.member_name || '',
      status: (b.status || '').replace('_', ' '), source: (b.source || 'member_portal').replace('_', ' '), booked_by: b.booked_by_name || '',
    }));
    filteredPTSessions.forEach((b: any) => rows.push({
      date: b.day, time: fmtTime(b.scheduled_at), type: 'PT', item: b.trainer_name || '',
      member_code: b.member_code || '', member_name: b.member_name || '',
      status: (b.status || '').replace('_', ' '), source: (b.source || 'member_portal').replace('_', ' '), booked_by: '',
    }));
    return rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  };

  const totalFiltered = filteredClassBookings.length + filteredBenefitBookings.length + filteredPTSessions.length;

  const handleExportCSV = () => {
    const rows = buildUnifiedRows();
    if (!rows.length) return;
    exportToCSV(rows, `bookings_${startDate}_${endDate}`, [
      { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' }, { key: 'type', label: 'Type' },
      { key: 'item', label: 'Item / Trainer' }, { key: 'member_code', label: 'Member Code' },
      { key: 'member_name', label: 'Member Name' }, { key: 'status', label: 'Status' },
      { key: 'source', label: 'Source' }, { key: 'booked_by', label: 'Booked By' },
    ]);
  };

  const handlePrint = () => {
    const rows = buildUnifiedRows();
    if (!rows.length) return;
    const filters = [
      statusFilter !== 'all' ? `Status: ${statusFilter}` : '',
      sourceFilter !== 'all' ? `Source: ${sourceFilter}` : '',
      searchQuery ? `Search: ${searchQuery}` : '',
    ].filter(Boolean).join(' · ');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bookings ${e(rangeLabel)}</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;color:#0f172a;padding:24px;}
  h1{margin:0 0 4px;font-size:20px;}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;}
  th{background:#f1f5f9;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em;color:#475569;}
  tr:nth-child(even) td{background:#fafafa;}
  @media print{button{display:none}}
</style></head><body>
<h1>All Bookings — ${e(rangeLabel)}</h1>
<div class="meta">${e(totalFiltered + ' rows')}${filters ? ' · ' + e(filters) : ''}</div>
<table><thead><tr>
<th>Date</th><th>Time</th><th>Type</th><th>Item / Trainer</th><th>Member Code</th><th>Member Name</th><th>Status</th><th>Source</th><th>Booked By</th>
</tr></thead><tbody>
${rows.map((r) => `<tr>
<td>${e(r.date)}</td><td>${e(r.time)}</td><td>${e(r.type)}</td><td>${e(r.item)}</td>
<td>${e(r.member_code)}</td><td>${e(r.member_name)}</td><td>${e(r.status)}</td>
<td>${e(r.source)}</td><td>${e(r.booked_by)}</td>
</tr>`).join('')}
</tbody></table>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300);}</script>
</body></html>`;
    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  const TableSkeleton = () => (
    <div className="space-y-2 py-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
    </div>
  );

  const renderPrepRow = (b: any, compact = false) => {
    const due = b.prep_start_at.getTime() <= now.getTime();
    return (
      <div
        key={b.id}
        className={cn(
          'flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-all',
          due ? 'border-warning/40 bg-warning/5' : 'border-border bg-card',
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('p-2 rounded-full shrink-0', due ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')}>
            <Flame className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium truncate">{b.benefit_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {b.member_name || b.member_code} · session {format(b.starts_at, 'dd MMM HH:mm')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className={cn('text-sm font-semibold', due ? 'text-warning' : 'text-foreground')}>
              {countdownLabel(b.prep_start_at)}
            </p>
            {!compact && (
              <p className="text-xs text-muted-foreground">
                prep from {format(b.prep_start_at, 'dd MMM HH:mm')} · {Math.round(b.prep_minutes / 60)}h lead
              </p>
            )}
          </div>
          <AttendanceActions bookingId={b.id} status={b.status} compact />
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
                <Calendar className="h-6 w-6" />
              </div>
              All Bookings
            </h1>
            <p className="text-muted-foreground mt-1">
              Classes, facility sessions and PT across {rangeLabel} — with prep lead times and reschedule approvals.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex bg-muted rounded-xl p-1">
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-lg gap-1.5">
                <List className="h-4 w-4" /> List
              </Button>
              <Button variant={viewMode === 'prep' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('prep')} className="rounded-lg gap-1.5">
                <Flame className="h-4 w-4" /> Prep Queue
                {prepDueNow > 0 && <Badge className="ml-1 h-5 px-1.5 bg-warning text-warning-foreground">{prepDueNow}</Badge>}
              </Button>
              <Button variant={viewMode === 'timeline' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('timeline')} className="rounded-lg gap-1.5">
                <Activity className="h-4 w-4" /> Timeline
              </Button>
              <Button variant={viewMode === 'calendar' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('calendar')} className="rounded-lg gap-1.5">
                <CalendarDays className="h-4 w-4" /> Calendar
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={totalFiltered === 0} className="gap-2 rounded-xl">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={totalFiltered === 0} className="gap-2 rounded-xl">
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button onClick={() => setConciergeOpen(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/20">
              <Plus className="h-4 w-4" /> New Booking
            </Button>
          </div>
        </div>

        {/* Range selector */}
        <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-muted rounded-xl p-1">
                {([['today', 'Today'], ['3d', 'Next 3 days'], ['7d', 'Next 7 days'], ['custom', 'Custom']] as const).map(([k, label]) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={rangePreset === k ? 'default' : 'ghost'}
                    onClick={() => setRangePreset(k)}
                    className="rounded-lg"
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {rangePreset === 'custom' && (
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="range-start">Start date</label>
                  <Input id="range-start" type="date" value={customStart} onChange={(ev) => setCustomStart(ev.target.value)} className="w-[160px] rounded-xl" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <label className="sr-only" htmlFor="range-end">End date</label>
                  <Input id="range-end" type="date" value={customEnd} onChange={(ev) => setCustomEnd(ev.target.value)} className="w-[160px] rounded-xl" />
                </div>
              )}
              <Badge variant="outline" className="rounded-full">{rangeLabel}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Upcoming Bookings" value={totalBookings} icon={Calendar} />
          <StatCard title="Needs Prep Now" value={prepDueNow} icon={Flame} />
          <StatCard title="Confirmed" value={confirmedBookings} icon={Check} />
          <StatCard title="Attended" value={attendedBookings} icon={Users} />
        </div>

        {/* Prep strip on list view */}
        {viewMode === 'list' && prepQueue.length > 0 && (
          <Card className="rounded-2xl border-warning/30 bg-warning/5 shadow-lg shadow-warning/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="h-4 w-4 text-warning" /> Preparation queue
              </CardTitle>
              <CardDescription>Facilities that need advance setup — start times account for the required lead.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {prepQueue.slice(0, 3).map((b: any) => renderPrepRow(b, true))}
              {prepQueue.length > 3 && (
                <Button variant="ghost" size="sm" onClick={() => setViewMode('prep')} className="w-full rounded-xl">
                  View all {prepQueue.length} in the Prep Queue
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Prep Queue view */}
        {viewMode === 'prep' && (
          <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-warning" /> Preparation Queue</CardTitle>
              <CardDescription>
                Sorted by when preparation must begin (session time minus the facility's lead time).
                Set the lead time per facility under Facilities.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingBenefits ? <TableSkeleton /> : prepQueue.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Flame className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Nothing needs advance preparation in this range.</p>
                </div>
              ) : prepQueue.map((b: any) => renderPrepRow(b))}
            </CardContent>
          </Card>
        )}

        {/* Calendar view */}
        {viewMode === 'calendar' && (
          <Card className="rounded-2xl border-border/50 shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{format(calendarMonth, 'MMMM yyyy')}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setCalendarMonth((d) => subMonths(d, 1))} className="rounded-xl"><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setCalendarMonth(new Date())} className="rounded-xl">Today</Button>
                  <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setCalendarMonth((d) => addMonths(d, 1))} className="rounded-xl"><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calDays.map((day, idx) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const counts = monthlyBookings.byDay[dayStr];
                  const isCurrentMonth = isSameMonth(day, calendarMonth);
                  const isToday = isSameDay(day, new Date());
                  const inRange = dayStr >= startDate && dayStr <= endDate;
                  return (
                    <button
                      key={idx}
                      type="button"
                      aria-label={`Show bookings for ${dayStr}`}
                      className={cn(
                        'bg-card p-2 min-h-[78px] text-left cursor-pointer hover:bg-muted/50 transition-colors focus:ring-2 focus:ring-primary focus:outline-none',
                        !isCurrentMonth && 'opacity-40',
                        isToday && 'ring-2 ring-primary ring-inset',
                        inRange && 'bg-primary/5',
                      )}
                      onClick={() => {
                        setRangePreset('custom');
                        setCustomStart(dayStr);
                        setCustomEnd(dayStr);
                        setViewMode('list');
                      }}
                    >
                      <p className={cn('text-xs font-medium mb-1', isToday ? 'text-primary font-bold' : 'text-muted-foreground')}>{format(day, 'd')}</p>
                      {counts && (
                        <div className="flex flex-col gap-0.5">
                          {counts.classes > 0 && <span className="text-[10px] text-info">{counts.classes} class</span>}
                          {counts.benefits > 0 && <span className="text-[10px] text-success">{counts.benefits} facility</span>}
                          {counts.pt > 0 && <span className="text-[10px] text-warning">{counts.pt} PT</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timeline view */}
        {viewMode === 'timeline' && (
          <div className="space-y-4">
            <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="sr-only" htmlFor="timeline-date">Timeline date</label>
                  <Input id="timeline-date" type="date" value={timelineDate} onChange={(ev) => setTimelineDate(ev.target.value)} className="w-[180px] rounded-xl" />
                  <p className="text-sm text-muted-foreground">Click any slot chip to view attendees and full audit history.</p>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: 8 }).map((_, i) => {
                    const d = addDays(new Date(), i);
                    const ds = format(d, 'yyyy-MM-dd');
                    return (
                      <Button
                        key={ds}
                        size="sm"
                        variant={timelineDate === ds ? 'default' : 'outline'}
                        onClick={() => setTimelineDate(ds)}
                        className="rounded-xl shrink-0"
                      >
                        {i === 0 ? 'Today' : format(d, 'EEE dd')}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            <SlotAvailabilityTimeline branchId={branchId} date={timelineDate} onSlotClick={setActiveSlotId} />
          </div>
        )}

        {/* List view */}
        {viewMode === 'list' && (
          <>
            <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
              <CardContent className="pt-5">
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <label className="sr-only" htmlFor="booking-search">Search bookings</label>
                    <Input id="booking-search" placeholder="Search by member name or code..." value={searchQuery} onChange={(ev) => setSearchQuery(ev.target.value)} className="pl-10 rounded-xl" />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px] rounded-xl" aria-label="Filter by status"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="Status" /></SelectTrigger>
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
                    <SelectTrigger className="w-[160px] rounded-xl" aria-label="Filter by source"><SelectValue placeholder="Source" /></SelectTrigger>
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

            <Tabs defaultValue="benefits" className="space-y-4">
              <TabsList className="rounded-xl">
                <TabsTrigger value="benefits" className="gap-2 rounded-lg"><Heart className="h-4 w-4" />Facilities ({filteredBenefitBookings.length})</TabsTrigger>
                <TabsTrigger value="classes" className="gap-2 rounded-lg"><Calendar className="h-4 w-4" />Classes ({filteredClassBookings.length})</TabsTrigger>
                <TabsTrigger value="pt" className="gap-2 rounded-lg"><Dumbbell className="h-4 w-4" />PT ({filteredPTSessions.length})</TabsTrigger>
              </TabsList>

              {/* Facility bookings */}
              <TabsContent value="benefits">
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle>Facility Bookings</CardTitle>
                    <CardDescription>Sauna, ice bath, steam and other recovery sessions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {loadingBenefits ? <TableSkeleton /> : filteredBenefitBookings.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Heart className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>No facility bookings in {rangeLabel}.</p>
                        <Button variant="outline" size="sm" className="mt-4 rounded-xl" onClick={() => setConciergeOpen(true)}>
                          <Plus className="h-4 w-4 mr-1" /> Create a booking
                        </Button>
                      </div>
                    ) : groupByDay(filteredBenefitBookings).map(([day, rows]) => (
                      <div key={day} className="space-y-2">
                        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur py-1.5 flex items-center gap-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {format(parseISO(day), 'EEEE, dd MMM')}
                          </h3>
                          <Badge variant="secondary" className="text-[10px]">{rows.length}</Badge>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8" />
                              <TableHead>Member</TableHead>
                              <TableHead>Facility</TableHead>
                              <TableHead>Time Slot</TableHead>
                              <TableHead>Source</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((b: any) => {
                              const isOpen = expandedBooking === b.id;
                              const canReschedule = ['booked', 'confirmed'].includes(b.status);
                              return (
                                <>
                                  <TableRow key={b.id} className="hover:bg-muted/50 transition-colors">
                                    <TableCell>
                                      <button
                                        type="button"
                                        aria-label={isOpen ? 'Hide history' : 'Show history'}
                                        onClick={() => setExpandedBooking(isOpen ? null : b.id)}
                                        className="cursor-pointer focus:ring-2 focus:ring-primary focus:outline-none rounded"
                                      >
                                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                                      </button>
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-medium flex items-center gap-1.5">
                                        {b.member_name}
                                        {b.force_added && <ShieldAlert className="h-3.5 w-3.5 text-warning" />}
                                      </div>
                                      <div className="text-sm text-muted-foreground">{b.member_code}</div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1.5">
                                        <Badge variant="outline">{b.benefit_name}</Badge>
                                        {b.prep_minutes > 0 && (
                                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/25 text-[10px] gap-1">
                                            <Flame className="h-3 w-3" />{Math.round(b.prep_minutes / 60)}h prep
                                          </Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>{b.slot_time}</TableCell>
                                    <TableCell>
                                      <div className="flex flex-col gap-0.5">
                                        {renderSourceBadge(b.source)}
                                        {b.booked_by_name && <span className="text-[10px] text-muted-foreground">by {b.booked_by_name}</span>}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex flex-col items-start gap-1">
                                        {getStatusBadge(b.status)}
                                        {pendingReschedules[b.id] && (
                                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/25 text-[10px] gap-1">
                                            <AlertTriangle className="h-3 w-3" /> Reschedule pending
                                          </Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <AttendanceActions bookingId={b.id} status={b.status} compact />
                                        {canReschedule && !pendingReschedules[b.id] && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="rounded-xl gap-1.5 cursor-pointer"
                                            onClick={() => setRescheduleTarget({
                                              id: b.id,
                                              member_name: b.member_name,
                                              member_code: b.member_code,
                                              benefit_name: b.benefit_name,
                                              slot_time: b.slot_time,
                                              slot_date: b.slot_date,
                                              slot_id: b.slot_id,
                                            })}
                                          >
                                            <CalendarClock className="h-3.5 w-3.5" /> Reschedule
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
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
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Class bookings */}
              <TabsContent value="classes">
                <Card className="rounded-2xl">
                  <CardHeader><CardTitle>Class Bookings</CardTitle><CardDescription>Member bookings for group classes</CardDescription></CardHeader>
                  <CardContent className="space-y-6">
                    {loadingClasses ? <TableSkeleton /> : filteredClassBookings.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>No class bookings in {rangeLabel}.</p>
                      </div>
                    ) : groupByDay(filteredClassBookings).map(([day, rows]) => (
                      <div key={day} className="space-y-2">
                        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur py-1.5 flex items-center gap-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {format(parseISO(day), 'EEEE, dd MMM')}
                          </h3>
                          <Badge variant="secondary" className="text-[10px]">{rows.length}</Badge>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow><TableHead>Member</TableHead><TableHead>Class</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead>Booked At</TableHead></TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((b: any) => (
                              <TableRow key={b.id} className="hover:bg-muted/50 transition-colors">
                                <TableCell><div className="font-medium">{b.member_name}</div><div className="text-sm text-muted-foreground">{b.member_code}</div></TableCell>
                                <TableCell>{b.class_name}</TableCell>
                                <TableCell>{b.class_time && format(new Date(b.class_time), 'HH:mm')}</TableCell>
                                <TableCell>{getStatusBadge(b.status)}</TableCell>
                                <TableCell className="text-muted-foreground">{format(new Date(b.booked_at), 'dd MMM HH:mm')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PT sessions */}
              <TabsContent value="pt">
                <Card className="rounded-2xl">
                  <CardHeader><CardTitle>PT Sessions</CardTitle><CardDescription>Personal training sessions</CardDescription></CardHeader>
                  <CardContent className="space-y-6">
                    {loadingPT ? <TableSkeleton /> : filteredPTSessions.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Dumbbell className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>No PT sessions in {rangeLabel}.</p>
                      </div>
                    ) : groupByDay(filteredPTSessions).map(([day, rows]) => (
                      <div key={day} className="space-y-2">
                        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur py-1.5 flex items-center gap-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {format(parseISO(day), 'EEEE, dd MMM')}
                          </h3>
                          <Badge variant="secondary" className="text-[10px]">{rows.length}</Badge>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow><TableHead>Member</TableHead><TableHead>Trainer</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((s: any) => (
                              <TableRow key={s.id} className="hover:bg-muted/50 transition-colors">
                                <TableCell><div className="font-medium">{s.member_name}</div><div className="text-sm text-muted-foreground">{s.member_code}</div></TableCell>
                                <TableCell>{s.trainer_name}</TableCell>
                                <TableCell>{s.scheduled_at && format(new Date(s.scheduled_at), 'HH:mm')}</TableCell>
                                <TableCell>{getStatusBadge(s.status)}</TableCell>
                                <TableCell className="text-muted-foreground max-w-[200px] truncate">{s.notes || '-'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
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
      <RescheduleBookingDrawer
        booking={rescheduleTarget}
        branchId={branchId}
        onOpenChange={(open) => { if (!open) setRescheduleTarget(null); }}
      />
    </AppLayout>
  );
}
