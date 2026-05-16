import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { useAuth } from '@/contexts/AuthContext';
import { ensureSlotsForDateRange } from '@/services/benefitBookingService';
import {
  Calendar, Users, Loader2, AlertCircle, Dumbbell,
  Droplets, Gift, Check, X, CalendarDays,
} from 'lucide-react';
import { format, addDays, startOfDay } from 'date-fns';
import { toast } from 'sonner';

type FilterType = 'all' | 'recovery' | 'classes' | 'pt';

interface AgendaItem {
  id: string;
  type: 'class' | 'recovery' | 'pt';
  datetime: Date;
  title: string;
  subtitle: string;
  duration: number;
  spotsLeft?: number;
  capacity?: number;
  isBooked: boolean;
  bookingId?: string;
  rawData: any;
}

const FILTER_CHIPS: { value: FilterType; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: null },
  { value: 'recovery', label: 'Recovery', icon: <Droplets className="h-3.5 w-3.5" /> },
  { value: 'classes', label: 'Classes', icon: <Users className="h-3.5 w-3.5" /> },
  { value: 'pt', label: 'PT', icon: <Dumbbell className="h-3.5 w-3.5" /> },
];


function getTypeIcon(type: string) {
  switch (type) {
    case 'recovery': return <Droplets className="h-4 w-4 text-accent" />;
    case 'class': return <Users className="h-4 w-4 text-primary" />;
    case 'pt': return <Dumbbell className="h-4 w-4 text-secondary-foreground" />;
    default: return <Gift className="h-4 w-4" />;
  }
}

function getTypeBadge(type: string) {
  switch (type) {
    case 'recovery': return <Badge variant="outline" className="text-xs">Recovery</Badge>;
    case 'class': return <Badge variant="secondary" className="text-xs">Class</Badge>;
    case 'pt': return <Badge variant="default" className="text-xs">PT</Badge>;
    default: return null;
  }
}

export default function MemberClassBooking() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { member, activeMembership, ptPackages, isLoading: memberLoading } = useMemberData();
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [timeBucket, setTimeBucket] = useState<'all' | 'Morning' | 'Afternoon' | 'Evening' | 'Night'>('all');

  const today = startOfDay(new Date());
  const endDate = addDays(today, 13); // 2 weeks
  const todayStr = format(today, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // ─── Profile (gender filter) ───
  const { data: profile } = useQuery({
    queryKey: ['my-profile-gender', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('gender').eq('id', user!.id).maybeSingle();
      return data ?? null;
    },
  });

  // ─── Auto-generate recovery slots ───
  // Auto-generate recovery slots in background (fire-and-forget style)
  useQuery({
    queryKey: ['ensure-slots', member?.branch_id, todayStr, endDateStr],
    enabled: !!member?.branch_id,
    queryFn: async () => {
      try {
        await ensureSlotsForDateRange(member!.branch_id, todayStr, endDateStr);
      } catch (e) {
        console.warn('Slot auto-generation failed (will still show existing slots):', e);
      }
      return true;
    },
    staleTime: 0,
    retry: 2,
  });

  // ─── Fetch Classes (7 days) ───
  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ['agenda-classes', member?.branch_id, todayStr],
    enabled: !!member,
    queryFn: async () => {
      const dayStart = today.toISOString();
      const dayEnd = addDays(endDate, 1).toISOString();
      const { data, error } = await supabase
        .from('classes')
        .select('*, trainer:trainers(id, user_id), bookings:class_bookings(id, member_id, status)')
        .eq('branch_id', member!.branch_id)
        .eq('is_active', true)
        .gte('scheduled_at', dayStart)
        .lt('scheduled_at', dayEnd)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      // Fetch trainer profiles
      const result = await Promise.all(
        (data || []).map(async (cls: any) => {
          if (cls.trainer?.user_id) {
            const { data: p } = await supabase.from('profiles').select('full_name').eq('id', cls.trainer.user_id).maybeSingle();
            return { ...cls, trainer: { ...cls.trainer, profiles: p } };
          }
          return cls;
        })
      );
      return result;
    },
  });

  // ─── Fetch Recovery Slots (7 days) ───
  const { data: recoverySlots = [], isLoading: slotsLoading } = useQuery({
    queryKey: ['agenda-slots', member?.branch_id, todayStr, profile?.gender ?? 'unknown'],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_slots')
        .select('*, benefit_type_info:benefit_types(id, name, code, icon), facility:facilities(id, name, gender_access)')
        .eq('branch_id', member!.branch_id)
        .eq('is_active', true)
        .gte('slot_date', todayStr)
        .lte('slot_date', endDateStr)
        .order('slot_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      // Gender filter — hide gender-locked facilities that don't match member gender.
      // If member's gender is not set, hide ALL gender-locked facilities (only unisex shown)
      // and prompt member to update profile.
      const memberGender = profile?.gender;
      return (data || []).filter((slot: any) => {
        if (!slot.facility) return true;
        const access = slot.facility.gender_access;
        if (!access || access === 'unisex') return true;
        if (!memberGender) return false; // unknown gender → cannot book gender-locked
        return access === memberGender;
      });
    },
  });

  // ─── Fetch PT Sessions ───
  const ptPackageIds = ptPackages.map(p => p.id);
  const { data: ptSessions = [], isLoading: ptLoading } = useQuery({
    queryKey: ['agenda-pt', member?.id, ptPackageIds],
    enabled: !!member && ptPackageIds.length > 0,
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase
        .from('pt_sessions')
        .select('id, scheduled_at, duration_minutes, status, notes, trainer_id, member_pt_package_id')
        .in('member_pt_package_id', ptPackageIds)
        .eq('status', 'scheduled')
        .gte('scheduled_at', today.toISOString())
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      const trainerIds = [...new Set((data || []).map(s => s.trainer_id).filter(Boolean))] as string[];
      const trainersMap: Record<string, string> = {};
      if (trainerIds.length > 0) {
        const { data: trainers } = await supabase.from('trainers').select('id, user_id').in('id', trainerIds);
        if (trainers) {
          const userIds = trainers.map(t => t.user_id).filter(Boolean) as string[];
          const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
          trainers.forEach(t => {
            const p = profiles?.find(pr => pr.id === t.user_id);
            if (p) trainersMap[t.id] = p.full_name;
          });
        }
      }
      return (data || []).map(s => ({ ...s, trainerName: trainersMap[s.trainer_id || ''] || 'Trainer' }));
    },
  });

  // ─── Existing Bookings ───
  const { data: myClassBookings = [] } = useQuery({
    queryKey: ['my-class-bookings-agenda', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select('id, class_id, status')
        .eq('member_id', member!.id)
        .eq('status', 'booked');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: myBenefitBookings = [] } = useQuery({
    queryKey: ['my-benefit-bookings-agenda', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_bookings')
        .select('id, slot_id, status')
        .eq('member_id', member!.id)
        .in('status', ['booked', 'confirmed']);
      if (error) throw error;
      return data || [];
    },
  });

  // ─── Mutations ───
  const bookClass = useMutation({
    mutationFn: async (classId: string) => {
      const { data, error } = await supabase.rpc('book_class', { _class_id: classId, _member_id: member!.id });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Booking failed');
      return data;
    },
    onSuccess: () => {
      toast.success('Class booked!');
      queryClient.invalidateQueries({ queryKey: ['agenda-classes'] });
      queryClient.invalidateQueries({ queryKey: ['my-class-bookings-agenda'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to book class'),
  });

  const cancelClassBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await supabase.rpc('cancel_class_booking', { _booking_id: bookingId, _reason: 'Cancelled by member' });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Booking cancelled');
      queryClient.invalidateQueries({ queryKey: ['agenda-classes'] });
      queryClient.invalidateQueries({ queryKey: ['my-class-bookings-agenda'] });
    },
    onError: () => toast.error('Failed to cancel'),
  });

  const bookSlot = useMutation({
    mutationFn: async (slotId: string) => {
      if (!member || !activeMembership) throw new Error('No active membership');
      const { data, error } = await supabase.rpc('book_facility_slot', {
        p_slot_id: slotId,
        p_member_id: member.id,
        p_membership_id: activeMembership.id,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Booking failed');
      return result;
    },
    onSuccess: () => {
      toast.success('Slot booked!');
      queryClient.invalidateQueries({ queryKey: ['agenda-slots'] });
      queryClient.invalidateQueries({ queryKey: ['my-benefit-bookings-agenda'] });
      queryClient.invalidateQueries({ queryKey: ['my-entitlements'] });
    },
    onError: (e: any) => {
      const msg = e.message || 'Failed to book slot';
      if (msg.includes('Benefit limit reached')) {
        toast.error(msg, {
          action: {
            label: 'Buy More',
            onClick: () => window.location.href = '/my-benefits',
          },
          duration: 8000,
        });
      } else {
        toast.error(msg);
      }
    },
  });

  const cancelSlotBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await supabase.rpc('cancel_facility_slot', {
        p_booking_id: bookingId,
        p_reason: 'Cancelled by member',
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Cancellation failed');
      return result;
    },
    onSuccess: () => {
      toast.success('Booking cancelled');
      queryClient.invalidateQueries({ queryKey: ['agenda-slots'] });
      queryClient.invalidateQueries({ queryKey: ['my-benefit-bookings-agenda'] });
      queryClient.invalidateQueries({ queryKey: ['my-entitlements'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to cancel'),
  });

  // ─── Build Unified Agenda ───
  const classBookingMap = useMemo(() => {
    const map: Record<string, string> = {};
    myClassBookings.forEach((b: any) => { map[b.class_id] = b.id; });
    return map;
  }, [myClassBookings]);

  const slotBookingMap = useMemo(() => {
    const map: Record<string, string> = {};
    myBenefitBookings.forEach((b: any) => { map[b.slot_id] = b.id; });
    return map;
  }, [myBenefitBookings]);

  const agendaItems: AgendaItem[] = useMemo(() => {
    const items: AgendaItem[] = [];

    // Classes
    classes.forEach((cls: any) => {
      const bookedCount = cls.bookings?.filter((b: any) => b.status === 'booked').length || 0;
      const isBooked = !!classBookingMap[cls.id];
      items.push({
        id: cls.id,
        type: 'class',
        datetime: new Date(cls.scheduled_at),
        title: cls.name,
        subtitle: `${cls.duration_minutes} min${cls.trainer?.profiles?.full_name ? ` • ${cls.trainer.profiles.full_name}` : ''}`,
        duration: cls.duration_minutes || 60,
        spotsLeft: cls.capacity - bookedCount,
        capacity: cls.capacity,
        isBooked,
        bookingId: classBookingMap[cls.id],
        rawData: cls,
      });
    });

    // Recovery slots
    recoverySlots.forEach((slot: any) => {
      const spotsLeft = slot.capacity - (slot.booked_count || 0);
      const isBooked = !!slotBookingMap[slot.id];
      // If already booked by user, still show it; otherwise hide if booked already by others check not needed
      const facilityName = slot.facility?.name || slot.benefit_type_info?.name || 'Recovery';
      const durationMinutes = (() => {
        try {
          const s = new Date(`2000-01-01T${slot.start_time}`);
          const e = new Date(`2000-01-01T${slot.end_time}`);
          return Math.round((e.getTime() - s.getTime()) / 60000);
        } catch { return 30; }
      })();

      items.push({
        id: slot.id,
        type: 'recovery',
        datetime: new Date(`${slot.slot_date}T${slot.start_time}`),
        title: facilityName,
        subtitle: `${durationMinutes} min`,
        duration: durationMinutes,
        spotsLeft,
        capacity: slot.capacity,
        isBooked,
        bookingId: slotBookingMap[slot.id],
        rawData: slot,
      });
    });

    // PT sessions
    ptSessions.forEach((s: any) => {
      items.push({
        id: s.id,
        type: 'pt',
        datetime: new Date(s.scheduled_at),
        title: 'PT Session',
        subtitle: `${s.duration_minutes || 60} min • ${s.trainerName}`,
        duration: s.duration_minutes || 60,
        isBooked: true,
        rawData: s,
      });
    });

    return items.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
  }, [classes, recoverySlots, ptSessions, classBookingMap, slotBookingMap]);

  // ─── Filter to selected day + active filter ───
  const dayItems = useMemo(() => {
    let items = agendaItems.filter(i => format(i.datetime, 'yyyy-MM-dd') === selectedDateStr);
    if (activeFilter === 'recovery') items = items.filter(i => i.type === 'recovery');
    else if (activeFilter === 'classes') items = items.filter(i => i.type === 'class');
    else if (activeFilter === 'pt') items = items.filter(i => i.type === 'pt');
    if (showMyBookings) items = items.filter(i => i.isBooked);
    return items;
  }, [agendaItems, activeFilter, showMyBookings, selectedDateStr]);

  // ─── Group by time-of-day bucket ───
  const timeGroups = useMemo(() => {
    const buckets: Record<string, AgendaItem[]> = {
      Morning: [],     // < 12:00
      Afternoon: [],   // 12:00 - 16:59
      Evening: [],     // 17:00 - 20:59
      Night: [],       // >= 21:00
    };
    dayItems.forEach(it => {
      const h = it.datetime.getHours();
      if (h < 12) buckets.Morning.push(it);
      else if (h < 17) buckets.Afternoon.push(it);
      else if (h < 21) buckets.Evening.push(it);
      else buckets.Night.push(it);
    });
    return buckets;
  }, [dayItems]);

  // Date strip — next 14 days
  const dateStrip = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, [today]);

  // Per-day counts for badge on date strip (uses unfiltered agenda)
  const countsByDay = useMemo(() => {
    const m: Record<string, number> = {};
    agendaItems.forEach(it => {
      const k = format(it.datetime, 'yyyy-MM-dd');
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [agendaItems]);

  const isLoading = memberLoading || classesLoading || slotsLoading || ptLoading;

  if (memberLoading) {
    return <AppLayout><div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div></AppLayout>;
  }
  if (!member) {
    return <AppLayout><div className="flex flex-col items-center justify-center min-h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-warning" /><h2 className="text-xl font-semibold">No Member Profile Found</h2></div></AppLayout>;
  }

  const noGenderSet = !profile?.gender;
  const totalForDay = dayItems.length;

  return (
    <AppLayout>
      <div className="space-y-5 max-w-5xl mx-auto">
        {/* ─── Hero: Date Strip ─── */}
        <Card className="border-0 shadow-lg shadow-indigo-500/10 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 text-white overflow-hidden">
          <CardContent className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Book & Schedule</h1>
                <p className="text-white/80 text-sm mt-0.5">
                  {format(selectedDate, 'EEEE, d MMMM yyyy')}
                  {totalForDay > 0 && ` • ${totalForDay} session${totalForDay > 1 ? 's' : ''}`}
                </p>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="icon" className="shrink-0 bg-white/15 hover:bg-white/25 text-white border-0">
                    <CalendarDays className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => { if (d) setSelectedDate(startOfDay(d)); }}
                    disabled={(d) => d < today || d > endDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Horizontal date strip */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
              {dateStrip.map(d => {
                const k = format(d, 'yyyy-MM-dd');
                const isSelected = k === selectedDateStr;
                const count = countsByDay[k] || 0;
                return (
                  <button
                    key={k}
                    onClick={() => setSelectedDate(d)}
                    className={`shrink-0 w-14 sm:w-16 rounded-2xl py-2.5 transition-all ${
                      isSelected
                        ? 'bg-white text-indigo-700 shadow-lg scale-105'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
                      {format(d, 'EEE')}
                    </div>
                    <div className={`text-xl font-bold ${isSelected ? '' : ''}`}>
                      {format(d, 'd')}
                    </div>
                    {count > 0 && (
                      <div className={`mt-1 mx-auto h-1 w-1 rounded-full ${isSelected ? 'bg-indigo-700' : 'bg-white/70'}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ─── Filter Chips ─── */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTER_CHIPS.map(chip => (
            <Button
              key={chip.value}
              size="sm"
              variant={activeFilter === chip.value ? 'default' : 'outline'}
              className="rounded-full h-8 px-4 text-xs"
              onClick={() => setActiveFilter(chip.value)}
            >
              {chip.icon && <span className="mr-1">{chip.icon}</span>}
              {chip.label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button
            size="sm"
            variant={showMyBookings ? 'default' : 'outline'}
            className="rounded-full h-8 px-4 text-xs"
            onClick={() => setShowMyBookings(!showMyBookings)}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            My Bookings
          </Button>
        </div>

        {/* ─── Profile gender warning ─── */}
        {noGenderSet && (activeFilter === 'all' || activeFilter === 'recovery') && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="flex-1 text-sm">
                <span className="font-medium">Add your gender to your profile</span>
                <span className="text-muted-foreground"> to see male/female-only recovery facilities.</span>
              </div>
              <Button size="sm" variant="outline" asChild>
                <a href="/member-profile">Update</a>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ─── No membership warning ─── */}
        {!activeMembership && (
          <Card className="border-warning/20 bg-warning/5">
            <CardContent className="py-4 text-center">
              <AlertCircle className="h-8 w-8 mx-auto text-warning mb-2" />
              <p className="text-sm font-medium">No active membership — booking is disabled</p>
            </CardContent>
          </Card>
        )}

        {/* ─── Loading ─── */}
        {isLoading && (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
        )}

        {/* ─── Empty state ─── */}
        {!isLoading && totalForDay === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-1">
                {showMyBookings ? 'No bookings on this day' : 'Nothing scheduled for this day'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {showMyBookings ? 'Pick another date or book a session.' : 'Try another date from the strip above.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ─── Time-bucket sub-tabs ─── */}
        {!isLoading && totalForDay > 0 && (
          <Tabs value={timeBucket} onValueChange={(v) => setTimeBucket(v as any)} className="w-full">
            <TabsList className="grid grid-cols-5 w-full h-auto p-1 rounded-2xl bg-muted/60">
              <TabsTrigger value="all" className="rounded-xl text-xs py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                All <span className="ml-1 opacity-60">{totalForDay}</span>
              </TabsTrigger>
              {(['Morning', 'Afternoon', 'Evening', 'Night'] as const).map(b => (
                <TabsTrigger
                  key={b}
                  value={b}
                  disabled={timeGroups[b].length === 0}
                  className="rounded-xl text-xs py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  {b} <span className="ml-1 opacity-60">{timeGroups[b].length}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {(['all', 'Morning', 'Afternoon', 'Evening', 'Night'] as const).map(bucket => {
              const items = bucket === 'all'
                ? (['Morning', 'Afternoon', 'Evening', 'Night'] as const).flatMap(b => timeGroups[b])
                : timeGroups[bucket];
              return (
                <TabsContent key={bucket} value={bucket} className="mt-4 space-y-2.5">
                  {items.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">No sessions in this time slot.</div>
                  ) : (
                    items.map(item => (
                      <AgendaCard
                        key={`${item.type}-${item.id}`}
                        item={item}
                        activeMembership={activeMembership}
                        onBookClass={(id) => bookClass.mutate(id)}
                        onCancelClass={(id) => cancelClassBooking.mutate(id)}
                        onBookSlot={(id) => bookSlot.mutate(id)}
                        onCancelSlot={(id) => cancelSlotBooking.mutate(id)}
                        isBooking={bookClass.isPending || bookSlot.isPending}
                        isCancelling={cancelClassBooking.isPending || cancelSlotBooking.isPending}
                      />
                    ))
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

// ─── Agenda Card Component ───
function AgendaCard({
  item,
  activeMembership,
  onBookClass,
  onCancelClass,
  onBookSlot,
  onCancelSlot,
  isBooking,
  isCancelling,
}: {
  item: AgendaItem;
  activeMembership: any;
  onBookClass: (id: string) => void;
  onCancelClass: (bookingId: string) => void;
  onBookSlot: (id: string) => void;
  onCancelSlot: (bookingId: string) => void;
  isBooking: boolean;
  isCancelling: boolean;
}) {
  const isFull = item.spotsLeft !== undefined && item.spotsLeft <= 0;

  return (
    <Card className={`border-border/50 transition-colors ${item.isBooked ? 'bg-accent/10 border-l-4 border-l-accent border-accent/30' : ''}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-4">
          {/* Time Column */}
          <div className="w-16 shrink-0 text-center">
            <p className="text-sm font-bold">{format(item.datetime, 'h:mm')}</p>
            <p className="text-xs text-muted-foreground">{format(item.datetime, 'a')}</p>
          </div>

          {/* Divider */}
          <div className="w-px h-10 bg-border/50" />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {getTypeIcon(item.type)}
              <h3 className="font-semibold text-sm truncate">{item.title}</h3>
              {item.isBooked && (
                <Badge className="bg-accent/20 text-accent border-accent/30 text-[10px] px-1.5 py-0">
                  <Check className="h-2.5 w-2.5 mr-0.5" />Booked
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {getTypeBadge(item.type)}
              <span className="text-xs text-muted-foreground">{item.subtitle}</span>
            </div>
          </div>

          {/* Spots + Action */}
          <div className="flex items-center gap-2 shrink-0">
            {item.spotsLeft !== undefined && !item.isBooked && (
              <Badge variant={isFull ? 'destructive' : item.spotsLeft <= 3 ? 'secondary' : 'outline'} className="text-xs">
                {isFull ? 'Full' : `${item.spotsLeft} spots`}
              </Badge>
            )}

            {item.type === 'pt' ? (
              <Badge variant="default" className="text-xs">Scheduled</Badge>
            ) : item.isBooked ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={isCancelling}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />Cancel
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel Booking?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to cancel your booking for <strong>{item.title}</strong> at {format(item.datetime, 'h:mm a')}? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        if (item.type === 'class') onCancelClass(item.bookingId!);
                        else onCancelSlot(item.bookingId!);
                      }}
                    >
                      Yes, Cancel
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={isFull || !activeMembership || isBooking}
                onClick={() => {
                  if (item.type === 'class') onBookClass(item.id);
                  else onBookSlot(item.id);
                }}
              >
                <Check className="h-3.5 w-3.5 mr-1" />Book
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
