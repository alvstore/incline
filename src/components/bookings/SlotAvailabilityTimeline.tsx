import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Heart, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlotAvailabilityTimelineProps {
  branchId: string;
  date: string; // yyyy-MM-dd
  onSlotClick?: (slotId: string) => void;
}

export function SlotAvailabilityTimeline({ branchId, date, onSlotClick }: SlotAvailabilityTimelineProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['slot-availability-timeline', branchId, date],
    enabled: !!branchId && !!date,
    queryFn: async () => {
      // Ensure today's slots exist
      await supabase.rpc('ensure_facility_slots', {
        p_branch_id: branchId,
        p_start_date: date,
        p_end_date: date,
      });

      const { data: slots, error } = await supabase
        .from('benefit_slots')
        .select('id, benefit_type, benefit_type_id, facility_id, start_time, end_time, capacity, booked_count, is_active')
        .eq('branch_id', branchId)
        .eq('slot_date', date)
        .order('start_time');
      if (error) throw error;

      const facilityIds = [...new Set((slots || []).map((s: any) => s.facility_id).filter(Boolean))];
      const benefitTypeIds = [...new Set((slots || []).map((s: any) => s.benefit_type_id).filter(Boolean))];

      const [{ data: facilities }, { data: types }] = await Promise.all([
        facilityIds.length
          ? supabase.from('facilities').select('id, name').in('id', facilityIds)
          : Promise.resolve({ data: [] as any[] }),
        benefitTypeIds.length
          ? supabase.from('benefit_types').select('id, name').in('id', benefitTypeIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const facilityMap = (facilities || []).reduce((acc: any, f: any) => ({ ...acc, [f.id]: f.name }), {});
      const typeMap = (types || []).reduce((acc: any, t: any) => ({ ...acc, [t.id]: t.name }), {});

      const grouped: Record<string, { name: string; slots: any[] }> = {};
      for (const s of slots || []) {
        const key = s.facility_id || s.benefit_type_id || s.benefit_type || 'other';
        const name =
          (s.facility_id && facilityMap[s.facility_id]) ||
          (s.benefit_type_id && typeMap[s.benefit_type_id]) ||
          s.benefit_type ||
          'Other';
        if (!grouped[key]) grouped[key] = { name, slots: [] };
        grouped[key].slots.push(s);
      }
      return Object.values(grouped);
    },
  });

  const fillClass = (slot: any) => {
    if (!slot.is_active) return 'bg-muted text-muted-foreground border-border line-through';
    const pct = slot.capacity ? slot.booked_count / slot.capacity : 0;
    if (slot.booked_count >= slot.capacity) return 'bg-destructive/15 text-destructive border-destructive/25';
    if (pct >= 0.9) return 'bg-destructive/10 text-destructive border-destructive/25';
    if (pct >= 0.6) return 'bg-warning/10 text-warning border-warning/25';
    return 'bg-success/10 text-success border-success/25';
  };

  if (isLoading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-8 text-center text-muted-foreground">Loading slot timeline…</CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-8 text-center text-muted-foreground">No facility slots configured for this date.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" /> Slot Availability Timeline
        </CardTitle>
        <CardDescription>
          Click any slot to see attendees. Colors: green = open · amber = filling · red = full.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.map((group) => (
          <div key={group.name} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">{group.name}</h4>
              <Badge variant="outline" className="text-[10px]">{group.slots.length} slots</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {group.slots.map((s: any) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSlotClick?.(s.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all hover:shadow-md hover:-translate-y-0.5',
                    fillClass(s),
                  )}
                >
                  <Clock className="h-3 w-3" />
                  {s.start_time?.slice(0, 5)}
                  <span className="opacity-70">·</span>
                  <span>{s.booked_count}/{s.capacity}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
