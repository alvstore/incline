import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { BookingStatusTimeline } from './BookingStatusTimeline';
import { useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, User } from 'lucide-react';

interface SlotDetailDrawerProps {
  slotId: string | null;
  onClose: () => void;
}

const SOURCE_BADGE: Record<string, string> = {
  member_portal: 'bg-success/10 text-success border-success/25',
  concierge: 'bg-primary/10 text-primary border-primary/25',
  whatsapp_ai: 'bg-info/10 text-info border-info/25',
  admin: 'bg-warning/10 text-warning border-warning/25',
  system: 'bg-muted text-foreground border-border',
};

export function SlotDetailDrawer({ slotId, onClose }: SlotDetailDrawerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['slot-detail', slotId],
    enabled: !!slotId,
    queryFn: async () => {
      const { data: slot } = await supabase
        .from('benefit_slots')
        .select('id, slot_date, start_time, end_time, capacity, booked_count, benefit_type, facility_id')
        .eq('id', slotId!)
        .single();

      const { data: bookings } = await supabase
        .from('benefit_bookings')
        .select('id, status, booked_at, source, force_added, booked_by_staff_id, member:members(id, member_code, user_id)')
        .eq('slot_id', slotId!)
        .order('booked_at', { ascending: true });

      const userIds = [
        ...(bookings || []).map((b: any) => b.member?.user_id),
        ...(bookings || []).map((b: any) => b.booked_by_staff_id),
      ].filter(Boolean) as string[];

      let names: Record<string, string> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', [...new Set(userIds)]);
        names = (profiles || []).reduce((acc: any, p: any) => ({ ...acc, [p.id]: p.full_name || '—' }), {});
      }

      const enriched = (bookings || []).map((b: any) => ({
        ...b,
        member_name: b.member?.user_id ? names[b.member.user_id] : b.member?.member_code,
        booked_by_name: b.booked_by_staff_id ? names[b.booked_by_staff_id] : null,
      }));

      return { slot, bookings: enriched };
    },
  });

  return (
    <Sheet open={!!slotId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Slot Details</SheetTitle>
          <SheetDescription>
            {data?.slot
              ? `${format(new Date(data.slot.slot_date), 'dd MMM yyyy')} · ${data.slot.start_time?.slice(0, 5)} – ${data.slot.end_time?.slice(0, 5)}`
              : ''}
          </SheetDescription>
        </SheetHeader>

        {isLoading && <p className="text-sm text-muted-foreground py-6">Loading…</p>}

        {data?.slot && (
          <div className="mt-4 mb-3 flex items-center gap-2 text-sm">
            <Badge variant="outline" className="rounded-lg">
              {data.slot.booked_count} / {data.slot.capacity} booked
            </Badge>
          </div>
        )}

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-2">
            {(data?.bookings || []).length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No bookings yet for this slot.</p>
            )}
            {(data?.bookings || []).map((b: any) => {
              const isOpen = expandedId === b.id;
              return (
                <div key={b.id} className="rounded-xl border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : b.id)}
                    className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/40 rounded-xl transition-colors"
                  >
                    <div className="mt-0.5">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{b.member_name || '—'}</span>
                        <Badge variant="outline" className="text-[10px]">{b.member?.member_code}</Badge>
                        <Badge variant="outline" className={`text-[10px] capitalize ${SOURCE_BADGE[b.source] || ''}`}>
                          {b.source?.replace('_', ' ') || 'member portal'}
                        </Badge>
                        {b.force_added && (
                          <Badge variant="outline" className="text-[10px] gap-1 bg-warning/10 text-warning border-warning/25">
                            <ShieldAlert className="h-3 w-3" /> force
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] capitalize">{b.status?.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Booked {format(new Date(b.booked_at), 'dd MMM HH:mm')}
                        {b.booked_by_name && (
                          <> · <User className="inline h-3 w-3" /> by {b.booked_by_name}</>
                        )}
                      </p>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 border-t border-border">
                      <BookingStatusTimeline bookingId={b.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
