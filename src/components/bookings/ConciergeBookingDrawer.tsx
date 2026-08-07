import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateBenefitData } from '@/lib/benefits/invalidateBenefitData';
import { format } from 'date-fns';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Calendar, Heart, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Textarea } from '@/components/ui/textarea';

interface ConciergeBookingDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  onSuccess?: () => void;
}

interface MemberResult {
  id: string;
  member_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  branch_id: string;
  member_status: string;
}

export function ConciergeBookingDrawer({ open, onOpenChange, branchId, onSuccess }: ConciergeBookingDrawerProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null);
  const [memberGender, setMemberGender] = useState<string | null>(null);
  const [serviceType, setServiceType] = useState<'class' | 'recovery'>('class');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [forceAdd, setForceAdd] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [booking, setBooking] = useState(false);

  // Fetch member gender after selection
  useEffect(() => {
    if (!selectedMember) {
      setMemberGender(null);
      return;
    }
    (async () => {
      const { data: member } = await supabase
        .from('members')
        .select('user_id')
        .eq('id', selectedMember.id)
        .single();
      if (member?.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('gender')
          .eq('id', member.user_id)
          .single();
        setMemberGender(profile?.gender?.toLowerCase() || null);
      }
    })();
  }, [selectedMember]);

  // Search members
  const { data: members = [], isLoading: searchLoading } = useQuery({
    queryKey: ['concierge-search', searchTerm, branchId],
    enabled: searchTerm.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_members', {
        search_term: searchTerm,
        p_branch_id: branchId,
        p_limit: 10,
      });
      if (error) throw error;
      return (data || []) as MemberResult[];
    },
  });

  // Fetch classes for selected date
  const { data: classes = [] } = useQuery({
    queryKey: ['concierge-classes', branchId, selectedDate],
    enabled: !!selectedMember && serviceType === 'class',
    queryFn: async () => {
      const startDate = new Date(selectedDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDate);
      endDate.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('classes')
        .select('id, name, scheduled_at, capacity, class_type')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .gte('scheduled_at', startDate.toISOString())
        .lte('scheduled_at', endDate.toISOString())
        .order('scheduled_at');

      if (error) throw error;

      const classIds = (data || []).map(c => c.id);
      if (classIds.length === 0) return [];

      const { data: bookings } = await supabase
        .from('class_bookings')
        .select('class_id')
        .in('class_id', classIds)
        .eq('status', 'booked');

      const countMap: Record<string, number> = {};
      (bookings || []).forEach(b => {
        countMap[b.class_id] = (countMap[b.class_id] || 0) + 1;
      });

      return (data || []).map(c => ({
        ...c,
        booked_count: countMap[c.id] || 0,
        is_full: (countMap[c.id] || 0) >= c.capacity,
      }));
    },
  });

  // Fetch facilities & filter by gender
  const { data: allFacilities = [] } = useQuery({
    queryKey: ['concierge-facilities', branchId],
    enabled: !!selectedMember && serviceType === 'recovery',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('facilities')
        .select('id, name, benefit_type_id, capacity, gender_access, available_days, under_maintenance')
        .eq('branch_id', branchId)
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
  });

  // Gender-filtered facilities
  const facilities = allFacilities.filter((f: any) => {
    if (!memberGender) return true; // if gender unknown, show all
    const access = (f.gender_access || 'unisex').toLowerCase();
    return access === 'unisex' || access === memberGender;
  });

  const [selectedFacility, setSelectedFacility] = useState<string>('');

  // Reset facility selection when facilities change (gender filter may remove current selection)
  useEffect(() => {
    if (selectedFacility && !facilities.find((f: any) => f.id === selectedFacility)) {
      setSelectedFacility('');
    }
  }, [facilities, selectedFacility]);

  // Weekly schedule gate — a facility can only be booked on the days it runs.
  const selectedFacilityRow = allFacilities.find((f: any) => f.id === selectedFacility) as
    | { name: string; available_days?: string[] | null }
    | undefined;
  const runsOnSelectedDate = selectedFacilityRow
    ? facilityRunsOn(selectedFacilityRow.available_days, selectedDate)
    : true;

  const { data: slots = [] } = useQuery({
    queryKey: ['concierge-slots', branchId, selectedDate, selectedFacility],
    enabled: !!selectedMember && serviceType === 'recovery' && !!selectedFacility && runsOnSelectedDate,
    queryFn: async () => {
      await supabase.rpc('ensure_facility_slots', {
        p_branch_id: branchId,
        p_start_date: selectedDate,
        p_end_date: selectedDate,
      });

      const { data, error } = await supabase
        .from('benefit_slots')
        .select('id, start_time, end_time, capacity, booked_count')
        .eq('branch_id', branchId)
        .eq('facility_id', selectedFacility)
        .eq('slot_date', selectedDate)
        .eq('is_active', true)
        .order('start_time');

      if (error) throw error;
      return data || [];
    },
  });

  const validateForce = (): boolean => {
    if (forceAdd && !forceReason.trim()) {
      toast.error('Please provide a reason for the force-add override.');
      return false;
    }
    return true;
  };

  const handleBookClass = async (classId: string) => {
    if (!selectedMember) return;
    if (!validateForce()) return;
    setBooking(true);
    try {
      // Class bookings still flow through the existing book_class RPC.
      // Force-add is not yet supported for classes — surface that clearly.
      if (forceAdd) {
        toast.error('Force-add for classes is not yet supported. Please cancel an existing booking instead.');
        return;
      }
      const { data, error } = await supabase.rpc('book_class', {
        _class_id: classId,
        _member_id: selectedMember.id,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success || result?.valid !== false) {
        toast.success(`Class booked for ${selectedMember.full_name}`);
        onSuccess?.();
        onOpenChange(false);
        resetState();
      } else {
        toast.error(result?.error || 'Booking failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const handleBookSlot = async (slotId: string) => {
    if (!selectedMember) return;
    if (!validateForce()) return;

    // Gender validation guard
    if (!forceAdd && memberGender && selectedFacility) {
      const facility = allFacilities.find((f: any) => f.id === selectedFacility);
      if (facility) {
        const access = ((facility as any).gender_access || 'unisex').toLowerCase();
        if (access !== 'unisex' && access !== memberGender) {
          toast.error(`Access Denied: This facility is restricted to "${access}" members. ${selectedMember.full_name} is "${memberGender}".`);
          return;
        }
      }
    }

    setBooking(true);
    try {
      const { data: membership } = await supabase
        .from('memberships')
        .select('id')
        .eq('member_id', selectedMember.id)
        .eq('status', 'active')
        .gte('end_date', new Date().toISOString().split('T')[0])
        .order('end_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!membership && !forceAdd) {
        toast.error('Member has no active membership. Toggle Force-add to override.');
        return;
      }

      const { data, error } = await supabase.rpc('book_facility_slot', {
        p_slot_id: slotId,
        p_member_id: selectedMember.id,
        p_membership_id: membership?.id ?? selectedMember.id,
        p_staff_id: user?.id ?? null,
        p_source: 'concierge',
        p_force: forceAdd,
        p_force_reason: forceAdd ? forceReason.trim() : null,
      });
      if (error) throw error;
      const result = data as {
        success: boolean;
        error?: string;
        force_added?: boolean;
        deduction?: { from_plan?: number; gift?: unknown[]; credit?: unknown[] };
      };
      if (!result.success) {
        toast.error(result.error || 'Booking failed');
        return;
      }

      const source = result.deduction?.from_plan
        ? 'plan allowance'
        : (result.deduction?.credit?.length ? 'purchased credits' : (result.deduction?.gift?.length ? 'complimentary sessions' : null));

      queryClient.invalidateQueries({ queryKey: ['agenda-slots'] });
      invalidateBenefitData(queryClient);

      toast.success(
        forceAdd
          ? `Slot force-booked for ${selectedMember.full_name}`
          : `Slot booked for ${selectedMember.full_name}`,
        source ? { description: `1 session deducted from ${source}.` } : undefined,
      );
      onSuccess?.();
      onOpenChange(false);
      resetState();
    } catch (err: any) {
      toast.error(err.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const resetState = () => {
    setSelectedMember(null);
    setMemberGender(null);
    setSearchTerm('');
    setForceAdd(false);
    setForceReason('');
    setSelectedFacility('');
  };

  const getGenderBadge = (access: string) => {
    const a = (access || 'unisex').toLowerCase();
    if (a === 'male') return <Badge variant="outline" className="text-xs bg-info/10 text-info border-info/25">♂ Male</Badge>;
    if (a === 'female') return <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/25">♀ Female</Badge>;
    return <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">Unisex</Badge>;
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Concierge Booking</SheetTitle>
          <SheetDescription>Book a class or facility slot on behalf of a member</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Step 1: Select Member */}
          {!selectedMember ? (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Step 1: Find Member</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, code, phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              {searchLoading && <p className="text-sm text-muted-foreground">Searching...</p>}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMember(m)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors text-left"
                  >
                    <div>
                      <div className="font-medium">{m.full_name}</div>
                      <div className="text-sm text-muted-foreground">{m.member_code} • {m.phone || m.email}</div>
                    </div>
                    <Badge variant={m.member_status === 'active' ? 'default' : 'secondary'}>
                      {m.member_status}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Selected member header */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div>
                  <div className="font-medium">{selectedMember.full_name}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    {selectedMember.member_code}
                    {memberGender && (
                      <Badge variant="outline" className="text-xs">
                        {memberGender === 'female' ? '♀ Female' : memberGender === 'male' ? '♂ Male' : memberGender}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedMember(null)}>Change</Button>
              </div>

              {/* Step 2: Select Service */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Step 2: Select Service & Date</Label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
                <Tabs value={serviceType} onValueChange={(v) => setServiceType(v as 'class' | 'recovery')}>
                  <TabsList className="w-full">
                    <TabsTrigger value="class" className="flex-1 gap-1">
                      <Calendar className="h-4 w-4" /> Classes
                    </TabsTrigger>
                    <TabsTrigger value="recovery" className="flex-1 gap-1">
                      <Heart className="h-4 w-4" /> Recovery
                    </TabsTrigger>
                  </TabsList>

                  {/* Classes */}
                  <TabsContent value="class" className="space-y-2 mt-3">
                    {classes.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No classes on this date</p>
                    ) : (
                      classes.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {format(new Date(c.scheduled_at), 'HH:mm')} • {c.booked_count}/{c.capacity} booked
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={booking || (c.is_full && !forceAdd)}
                            onClick={() => handleBookClass(c.id)}
                          >
                            {c.is_full ? 'Full' : 'Book'}
                          </Button>
                        </div>
                      ))
                    )}
                  </TabsContent>

                  {/* Recovery */}
                  <TabsContent value="recovery" className="space-y-3 mt-3">
                    {memberGender && allFacilities.length > facilities.length && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-warning/10 border border-warning/25 text-sm text-warning">
                        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                        <span>{allFacilities.length - facilities.length} facility(ies) hidden — gender restricted for {memberGender} members</span>
                      </div>
                    )}

                    <Select value={selectedFacility} onValueChange={setSelectedFacility}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select facility" />
                      </SelectTrigger>
                      <SelectContent>
                        {facilities.map((f: any) => (
                          <SelectItem key={f.id} value={f.id}>
                            <span className="flex items-center gap-2">
                              {f.name} {getGenderBadge(f.gender_access)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedFacility && (
                      <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                        {slots.length === 0 ? (
                          <p className="col-span-3 text-sm text-muted-foreground text-center py-4">No slots available</p>
                        ) : (
                          slots.map((s: any) => {
                            const available = s.booked_count < s.capacity;
                            return (
                              <Button
                                key={s.id}
                                variant={available ? 'outline' : 'ghost'}
                                size="sm"
                                disabled={booking || (!available && !forceAdd)}
                                onClick={() => handleBookSlot(s.id)}
                                className="text-xs"
                              >
                                {s.start_time?.slice(0, 5)}
                                {!available && <span className="ml-1 text-destructive">•</span>}
                              </Button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Force Add */}
              <div className="space-y-2 p-3 rounded-lg border border-dashed border-destructive/30 bg-destructive/5">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="force-add"
                    checked={forceAdd}
                    onCheckedChange={(v) => { setForceAdd(!!v); if (!v) setForceReason(''); }}
                  />
                  <label htmlFor="force-add" className="text-sm flex items-center gap-1 cursor-pointer font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    Force-add (override capacity, gender & window)
                  </label>
                </div>
                {forceAdd && (
                  <div className="space-y-1 pl-6">
                    <Label htmlFor="force-reason" className="text-xs text-muted-foreground">
                      Reason for override (audited) *
                    </Label>
                    <Textarea
                      id="force-reason"
                      value={forceReason}
                      onChange={(e) => setForceReason(e.target.value)}
                      placeholder="e.g. VIP guest, manager approval, system error compensation"
                      rows={2}
                      className="text-xs"
                      required
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Requires admin/owner/manager role. This action is permanently logged.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
